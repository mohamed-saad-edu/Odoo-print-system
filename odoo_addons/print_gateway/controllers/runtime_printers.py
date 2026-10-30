# -*- coding: utf-8 -*-
from ..models import gateway_http as requests
from werkzeug.exceptions import Forbidden

from odoo import http
from odoo.http import request
from odoo.exceptions import ValidationError
from ..runtime_policy import is_gateway_shared_printer, is_exact_gateway_printer_id, is_exact_gateway_agent_id, unambiguous_inventory_rows
from ..printer_geometry import validated_printer_geometry
from ..printer_verification import is_verified_runtime_printer


class PrintGatewayRuntimePrinterController(http.Controller):
    @http.route('/print_gateway/setup-context', type='jsonrpc', auth='user', methods=['POST'])
    def setup_context(self):
        """Expose authorized company scopes with unambiguous, stable labels."""
        self._require_runtime_admin()
        scopes = []
        seen_company_ids = set()
        for company in request.env.companies:
            # A repeated allowed_company_ids entry must not render twice in OWL.
            # Never collapse different Odoo company/branch records by name:
            # their IDs and printer assignments are independent.
            if company.id in seen_company_ids:
                continue
            seen_company_ids.add(company.id)
            # Routing/binding schemas intentionally accept only direct child
            # branches. A nested branch must NEVER be presented as a usable
            # printer assignment for its intermediate parent. Still show the
            # full path so the operator can understand why it is unavailable.
            nested = bool(company.parent_id and company.parent_id.parent_id)
            if nested:
                ancestry = []
                ancestor = company
                while ancestor:
                    ancestry.append((ancestor.name or ancestor.display_name or "").strip() or str(ancestor.id))
                    ancestor = ancestor.parent_id
                root = company
                while root.parent_id:
                    root = root.parent_id
                scopes.append({
                    'id': company.id,
                    'name': " / ".join(reversed(ancestry)),
                    'companyId': root.id,
                    'branchId': company.id,
                    'configId': False,
                    'assignable': False,
                })
                continue
            root, branch = self._scope(company.id)
            config, _root = self._get_config(root)
            root_name = (root.name or root.display_name or "").strip() or str(root.id)
            if branch:
                branch_name = (branch.name or branch.display_name or "").strip() or str(branch.id)
                label = "%s / %s" % (root_name, branch_name)
            else:
                label = root_name
            scopes.append({
                'id': company.id,
                'name': label,
                'companyId': root.id,
                'branchId': branch.id if branch else False,
                'configId': config.id if config else False,
            })

        # Distinct stored names may collide after display normalization.
        # Keep all their distinct authorization scopes; suffix only ambiguous
        # labels with the immutable Odoo company ID to prevent misrouting.
        counts = {}
        for scope in scopes:
            key = scope['name'].casefold()
            counts[key] = counts.get(key, 0) + 1
        # A user can literally name a company "My Company (#2)". If another
        # company called "My Company" has ID 2, a one-pass suffix operation
        # creates two identical displayed labels. Resolve collisions across
        # the *final* labels as well, without ever changing or merging IDs.
        used_labels = set()
        for scope in scopes:
            raw_name = scope['name']
            label = raw_name
            if counts[raw_name.casefold()] > 1 or label.casefold() in used_labels:
                label = "%s (#%s)" % (raw_name, scope['id'])
            while label.casefold() in used_labels:
                label = "%s (#%s)" % (label, scope['id'])
            scope['name'] = label
            used_labels.add(label.casefold())
        return {'scopes': scopes, 'currentCompanyId': request.env.company.id}

    @staticmethod
    def _require_runtime_admin():
        if not request.env.user.has_group("base.group_system"):
            raise Forbidden(request.env._("Access Denied: Runtime printer discovery is restricted to Odoo system administrators."))

    def _scope(self, company_id=None, branch_id=None, env=None):
        env = env if env is not None else request.env

        def exact_record_id(value, translated_error):
            # int(True), int(1.9), int(" 1") and int(1.0) all silently select
            # the wrong record. A printer assignment must never be coerced to
            # a different Odoo company/branch, even for an admin RPC caller.
            if type(value) is int:
                record_id = value
            elif (isinstance(value, str) and value.isascii()
                  and value.isdecimal() and len(value) <= 19):
                try:
                    record_id = int(value)
                except ValueError:
                    raise Forbidden(translated_error)
            else:
                raise Forbidden(translated_error)
            if not 0 < record_id <= 2**63 - 1:
                raise Forbidden(translated_error)
            return record_id

        # False is Odoo's standard 'no field value' sentinel. Any *other*
        # explicitly supplied value, including 0/empty strings, must be a
        # valid and exact ID rather than selecting the active company.
        if company_id is not None and company_id is not False:
            record_id = exact_record_id(company_id, env._("Access Denied: Invalid Odoo Company."))
            company = env["res.company"].browse(record_id).exists()
            if not company:
                raise Forbidden(env._("Access Denied: The selected Odoo Company is not available to the current user."))
        else:
            company = env.company
            if not company or company not in env.companies:
                raise Forbidden(env._("Access Denied: The active Odoo Company is not available to the current user."))

        branch = False
        if branch_id is not None and branch_id is not False:
            record_id = exact_record_id(branch_id, env._("Access Denied: Invalid Odoo Branch."))
            branch = env["res.company"].browse(record_id).exists()
            if not branch or branch not in env.companies:
                raise Forbidden(env._("Access Denied: The selected Odoo Branch is not available to the current user."))

        # A branch's parent is metadata; authority comes from the exact allowed branch.
        if company not in env.companies and not (branch and branch.parent_id == company):
            raise Forbidden(env._("Access Denied: The selected Odoo Company is not available to the current user."))

        if company.parent_id and company.parent_id.parent_id:
            # A parent-of-parent is not a valid root for direct-child printer
            # bindings. Do not silently promote a nested company and route a
            # document to an unrelated/default printer.
            raise ValidationError(env._("Nested Odoo branches are not supported for printer assignments."))

        if company.parent_id:
            # Tolerate branch-scoped callers (e.g. a branch cashier whose
            # active company is the branch itself): lift to the parent
            # company instead of rejecting.
            if not branch:
                branch = company
            elif branch.id != company.id and branch.parent_id.id != company.id:
                # A branch-scoped caller naming two different branches is rejected fail-closed; the assignment check below stays the authorization boundary.
                raise ValidationError(env._("Odoo Branch must belong directly to the selected Odoo Company."))
            company = company.parent_id

        if branch and branch == company:
            raise ValidationError(env._("Odoo Branch must be a child Branch, not the selected root Company."))

        if branch:
            if not branch.parent_id or branch.parent_id.id != company.id:
                raise ValidationError(env._("Odoo Branch must belong directly to the selected Odoo Company."))

        return company, branch

    def _get_config(self, company, env=None):
        env = env if env is not None else request.env
        root_company = company
        while root_company.parent_id:
            root_company = root_company.parent_id
        config = env["print_gateway.gateway_config"].sudo().search(
            [("company_id", "=", root_company.id)], limit=1,
        )
        return config, root_company

    def _assigned_runtime_agent_ids(self, company, branch, env=None):
        env = env if env is not None else request.env
        return env["print_gateway.runtime_agent_assignment"].assigned_agent_ids(company, branch)

    @http.route('/print_gateway/runtime-agents', type='jsonrpc', auth='user', methods=['POST'])
    def runtime_agents(self, company_id=None, branch_id=None, assignment_only=False):
        self._require_runtime_admin()
        company, branch = self._scope(company_id, branch_id)
        config, root_company = self._get_config(company)
        # Agent pairing/discovery must remain available while Odoo printing is
        # disabled. `enabled` controls print dispatch, not whether an admin can
        # choose a runtime agent in the Pair New Agent wizard. Authentication
        # remains inside the server-side Gateway configuration helpers.
        if not config:
            return {'enabled': False, 'selectedAgentId': False, 'agents': [], 'registeredAgentCount': 0, 'assignedAgentCount': 0}
        try:
            gateway_base = config._gateway_base(for_request=True)
            gateway_headers = config._gateway_headers()
        except ValidationError:
            raise
        except requests.RequestException as exc:
            raise ValidationError(request.env._('Gateway agent discovery is unavailable.')) from exc
        try:
            response = requests.get(
                '%s/api/odoo/agents' % gateway_base,
                headers=gateway_headers, timeout=5, allow_redirects=False,
            )
            if response.status_code != 200:
                raise ValidationError(request.env._('Gateway agent discovery failed (HTTP %s).') % response.status_code)
            if len(getattr(response, 'content', None) or b'') > 2 * 1024 * 1024:
                raise ValueError('Gateway agent discovery response exceeds 2 MiB')
            body = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise ValidationError(request.env._('Gateway agent discovery is unavailable.')) from exc
        agents = body.get('agents') if isinstance(body, dict) else None
        if not isinstance(agents, list):
            raise ValidationError(request.env._('Gateway returned an invalid agent discovery response.'))
        sanitized = []
        for agent in agents:
            if not isinstance(agent, dict):
                continue
            agent_id = agent.get('id')
            lifecycle = agent.get('lifecycle') if isinstance(agent.get('lifecycle'), str) else ''
            if not is_exact_gateway_agent_id(agent_id) or lifecycle != 'active':
                continue
            raw_name = agent.get('name') if isinstance(agent.get('name'), str) and agent.get('name').strip() else agent_id
            status = agent.get('status') if isinstance(agent.get('status'), str) else 'unknown'
            reported_status = agent.get('reportedStatus') if isinstance(agent.get('reportedStatus'), str) else status
            raw_freshness = agent.get('freshness')
            freshness = raw_freshness if isinstance(raw_freshness, str) and raw_freshness in {'fresh', 'stale', 'missing'} else 'missing'
            sanitized.append({
                'id': agent_id,
                'name': raw_name,
                'status': status,
                'reportedStatus': reported_status,
                'freshness': freshness,
                'lastSeenAt': agent.get('lastSeenAt') if isinstance(agent.get('lastSeenAt'), str) else False,
            })
        sanitized = unambiguous_inventory_rows(sanitized)
        # Binding pickers must only expose Agents explicitly assigned to the
        # selected Odoo scope. With no Branch selected, a company-wide binding
        # may use any Agent assigned to the root Company or one of its direct
        # child Branches. The Pair Agent wizard deliberately omits
        # assignment_only so it can discover a new Agent before creating that
        # assignment. This is a discovery filter, not the authorization
        # boundary; binding write-time validation remains authoritative.
        registered_agent_count = len(sanitized)
        assigned_agent_count = None
        if assignment_only:
            allowed_agent_ids = self._assigned_runtime_agent_ids(root_company, branch)
            assigned_agent_count = len(allowed_agent_ids)
            sanitized = [agent for agent in sanitized if agent["id"] in allowed_agent_ids]
        selected = sanitized[0]['id'] if len(sanitized) == 1 else False
        return {
            'enabled': True,
            'selectedAgentId': selected,
            'agents': sanitized,
            'registeredAgentCount': registered_agent_count,
            'assignedAgentCount': assigned_agent_count,
        }

    @http.route('/print_gateway/runtime-printers', type='jsonrpc', auth='user', methods=['POST'])
    def runtime_printers(self, company_id=None, branch_id=None, agent_id=None):
        self._require_runtime_admin()
        company, branch = self._scope(company_id, branch_id)
        # Agent IDs are opaque Gateway execution identities, not display
        # labels. A padded/control-bearing RPC value must not be normalized
        # into a different, assigned Agent's printer inventory. This matches
        # the Gateway canonical agt_ + eight-character ID at the Odoo boundary.
        if not is_exact_gateway_agent_id(agent_id):
            return {'enabled': True, 'selectedAgentId': False, 'printers': []}
        config, root_company = self._get_config(company)
        if not config:
            return {'enabled': False, 'selectedAgentId': False, 'printers': []}

        selected_agent_id = agent_id

        # A branch-scoped printer inventory is an object-level discovery surface:
        # a valid tenant Agent is not automatically authorized for every Odoo
        # Branch. Enforce the same explicit Branch -> Agent assignment used by
        # Binding writes, so a crafted RPC call cannot inspect another branch's
        # printer inventory even when the caller is a system administrator.
        allowed_agent_ids = self._assigned_runtime_agent_ids(root_company, branch)
        if selected_agent_id not in allowed_agent_ids:
            raise Forbidden(
                request.env._('Access Denied: The selected Gateway Agent is not assigned to this Odoo scope.')
            )

        # Validate that the selected Agent is active and belongs to the same
        # Gateway tenant before exposing its printer inventory. Branch-scoped
        # callers have already passed the explicit assignment check above.
        try:
            agent_response = requests.get(
                '%s/api/odoo/agents' % config._gateway_base(for_request=True),
                headers=config._gateway_headers(), timeout=5, allow_redirects=False,
            )
            if agent_response.status_code != 200:
                raise ValidationError(request.env._('Gateway agent discovery failed (HTTP %s).') % agent_response.status_code)
            if len(getattr(agent_response, 'content', None) or b'') > 2 * 1024 * 1024:
                raise ValueError('Gateway agent discovery response exceeds 2 MiB')
            agent_body = agent_response.json() if agent_response.content else {}
            all_agents = agent_body.get('agents') if isinstance(agent_body, dict) else None
        except ValidationError:
            raise
        except (requests.RequestException, ValueError) as exc:
            raise ValidationError(request.env._('Gateway agent discovery is unavailable.')) from exc
        if not isinstance(all_agents, list):
            raise ValidationError(request.env._('Gateway returned an invalid agent discovery response.'))
        matched_agent = next(
            (a for a in unambiguous_inventory_rows(all_agents) if a.get('id') == selected_agent_id and a.get('lifecycle') == 'active'),
            None,
        )
        if not matched_agent:
            raise Forbidden(request.env._('Access Denied: The selected Gateway Agent is not active in this tenant.'))

        try:
            response = requests.get(
                '%s/api/odoo/printers' % config._gateway_base(for_request=True),
                headers=config._gateway_headers(),
                params={'agent_id': selected_agent_id},
                timeout=5, allow_redirects=False,
            )
            if response.status_code != 200:
                raise ValidationError(request.env._('Gateway printer discovery failed (HTTP %s).') % response.status_code)
            if len(getattr(response, 'content', None) or b'') > 2 * 1024 * 1024:
                raise ValueError('Gateway printer discovery response exceeds 2 MiB')
            body = response.json()
        except ValidationError:
            raise
        except (requests.RequestException, ValueError) as exc:
            raise ValidationError(request.env._('Gateway printer discovery is unavailable.')) from exc
        printers = body.get('printers') if isinstance(body, dict) else None
        if not isinstance(printers, list):
            raise ValidationError(request.env._('Gateway returned an invalid printer discovery response.'))
        sanitized = []
        for printer in printers:
            if not isinstance(printer, dict):
                continue
            printer_id = printer.get('id')
            if not is_exact_gateway_printer_id(printer_id):
                continue
            lifecycle = printer.get('lifecycle') if isinstance(printer.get('lifecycle'), str) else ''
            agent = printer.get('agent') if isinstance(printer.get('agent'), dict) else {}
            returned_agent_id = agent.get('id') if isinstance(agent.get('id'), str) else ''
            if lifecycle != 'active' or returned_agent_id != selected_agent_id or not is_gateway_shared_printer(printer):
                continue
            if not is_verified_runtime_printer(printer):
                continue
            capabilities = printer.get('capabilities') if isinstance(printer.get('capabilities'), dict) else {}
            raw_supported = capabilities.get('supported_protocols')
            supported_protocols = []
            if isinstance(raw_supported, list):
                allowed_protocols = {'pdf', 'image', 'jpeg', 'raw', 'escpos', 'zpl', 'tspl', 'spooler', 'ipp', 'ipps'}
                for value in raw_supported:
                    if not isinstance(value, str):
                        continue
                    normalized = value.strip().lower()
                    if normalized in allowed_protocols and normalized not in supported_protocols:
                        supported_protocols.append(normalized)
            # Preserve absent legacy metadata versus an explicit capability restriction.
            sanitized_capabilities = {'operational_verification': dict(capabilities['operational_verification'])}
            if 'supported_protocols' in capabilities:
                sanitized_capabilities['supported_protocols'] = supported_protocols
            geometry = validated_printer_geometry(capabilities.get('geometry'), printer_id)
            if geometry:
                sanitized_capabilities['geometry'] = geometry
            paper_width = capabilities.get('paper_width_mm')
            if type(paper_width) is int and paper_width in (58, 80):
                sanitized_capabilities['paper_width_mm'] = paper_width
            raw_freshness = printer.get('freshness')
            sanitized.append({
                'id': printer_id,
                'sharedWithGateway': True,
                'name': printer.get('name') if isinstance(printer.get('name'), str) else printer_id,
                'status': printer.get('status') if isinstance(printer.get('status'), str) else 'unknown',
                'reportedStatus': printer.get('reportedStatus') if isinstance(printer.get('reportedStatus'), str) else 'unknown',
                'freshness': raw_freshness if isinstance(raw_freshness, str) and raw_freshness in {'fresh', 'stale', 'missing'} else 'missing',
                'lastSeenAt': printer.get('lastSeenAt') if isinstance(printer.get('lastSeenAt'), str) else False,
                'deviceClass': printer.get('deviceClass') if isinstance(printer.get('deviceClass'), str) else 'unknown',
                'connectionType': printer.get('connectionType') if isinstance(printer.get('connectionType'), str) else 'unknown',
                'protocol': printer.get('protocol') if isinstance(printer.get('protocol'), str) else 'unknown',
                'printerType': 'file' if printer.get('outputMedium') == 'file' else 'physical',
                'outputMedium': printer['outputMedium'],
                'verificationState': 'verified',
                'verificationVerifiedAt': printer['verificationVerifiedAt'],
                'verificationReceivedAt': printer['verificationReceivedAt'],
                'verificationReason': None,
                'capabilities': sanitized_capabilities,
                'agentId': returned_agent_id,
                'agentName': agent.get('name') if isinstance(agent.get('name'), str) else selected_agent_id,
            })
        sanitized = unambiguous_inventory_rows(sanitized)
        return {'enabled': True, 'selectedAgentId': selected_agent_id, 'printers': sanitized}
