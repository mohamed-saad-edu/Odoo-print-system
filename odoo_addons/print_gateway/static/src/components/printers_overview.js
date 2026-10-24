/** @odoo-module */

import { Component, onWillStart, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";
import { startRpcWithDeadline } from "../js/async_control";
import { isVerifiedRuntimePrinter } from "../js/printer_verification";

/** Live inventory uses exactly the same company/assignment/verification fences
 * as the existing binding picker. Navigation never silently creates a route. */
export class PrintersOverview extends Component {
    static template = "print_gateway.PrintersOverview";
    static props = ["*"];

    setup() {
        this.action = useService("action");
        this.state = useState({ scopes: [], scopeId: 0, agents: [], agentId: "", printers: [], loading: true, error: "" });
        this.alive = true;
        this.generation = 0;
        this.request = null;
        onWillStart(async () => {
            try {
                const context = await this.call("/print_gateway/setup-context", {});
                if (!this.alive) return;
                this.state.scopes = context.scopes || [];
                const requested = this.props.action?.context?.default_company_id;
                this.state.scopeId = this.state.scopes.find(scope => scope.id === requested)?.id
                    || this.state.scopes.find(scope => scope.id === context.currentCompanyId)?.id
                    || this.state.scopes[0]?.id || 0;
                await this.refresh();
            } catch {
                if (this.alive) {
                    this.state.error = _t("Printer setup could not be loaded. Check your company access and try again.");
                    this.state.loading = false;
                }
            }
        });
        onWillUnmount(() => { this.alive = false; this.generation++; this.request?.cancel(); });
    }

    get scope() { return this.state.scopes.find(scope => scope.id === this.state.scopeId); }

    async call(route, params) {
        this.request?.cancel();
        this.request = startRpcWithDeadline(rpc, route, params, {
            timeoutMessage: _t("The printing service took too long to respond. Check the connection and try again."),
        });
        return this.request.promise;
    }

    async changeScope(event) {
        this.state.scopeId = Number(event.target.value);
        this.state.agentId = "";
        await this.refresh();
    }

    async changeAgent(event) {
        this.state.agentId = event.target.value;
        await this.refresh();
    }

    async refresh() {
        const generation = ++this.generation;
        const scope = this.scope;
        this.state.loading = true;
        this.state.error = "";
        this.state.printers = [];
        this.state.agents = [];
        if (!scope) { this.state.loading = false; return; }
        const params = { company_id: scope.companyId, branch_id: scope.branchId };
        try {
            const result = await this.call("/print_gateway/runtime-agents", { ...params, assignment_only: true });
            if (!this.alive || generation !== this.generation) return;
            this.state.agents = Array.isArray(result?.agents) ? result.agents : [];
            if (!this.state.agents.some(agent => agent.id === this.state.agentId)) {
                this.state.agentId = this.state.agents.length === 1 ? this.state.agents[0].id : "";
            }
            if (this.state.agentId) {
                const printers = await this.call("/print_gateway/runtime-printers", { ...params, agent_id: this.state.agentId });
                if (!this.alive || generation !== this.generation) return;
                this.state.printers = Array.isArray(printers?.printers) ? printers.printers : [];
            }
        } catch {
            if (this.alive && generation === this.generation) {
                this.state.error = _t("Printers could not be refreshed. Check the connection and make sure this computer is assigned to the selected company or branch.");
            }
        } finally {
            if (this.alive && generation === this.generation) this.state.loading = false;
        }
    }

    isReady(printer) {
        return isVerifiedRuntimePrinter(printer) && printer.freshness === "fresh" && ["online", "busy"].includes(printer.status);
    }

    status(printer) {
        if (!isVerifiedRuntimePrinter(printer)) return _t("Verifying");
        if (printer.freshness !== "fresh" || printer.status === "offline") return _t("Unavailable");
        if (printer.status === "busy") return _t("Printing");
        if (printer.status === "online") return _t("Ready");
        return _t("Needs attention");
    }

    connect() { return this.action.doAction("print_gateway.action_print_gateway_config"); }
    assignments() {
        const scope = this.scope;
        return this.action.doAction("print_gateway.action_print_gateway_runtime_assignments", {
            additionalContext: { default_company_id: scope?.companyId, default_branch_id: scope?.branchId || false },
        });
    }
    mappings() { return this.action.doAction("print_gateway.action_print_gateway_binding"); }
    choose(printer) {
        if (!this.isReady(printer) || !this.scope || !this.state.agentId) return;
        return this.action.doAction({
            type: "ir.actions.act_window", res_model: "print_gateway.binding", views: [[false, "form"]], target: "current",
            context: { default_company_id: this.scope.companyId, default_branch_id: this.scope.branchId || false,
                default_runtime_agent_id: this.state.agentId, default_printer_id: printer.id },
        });
    }
}

registry.category("actions").add("print_gateway.printers", PrintersOverview);
