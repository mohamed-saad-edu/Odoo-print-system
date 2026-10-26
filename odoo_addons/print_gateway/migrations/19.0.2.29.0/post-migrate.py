"""Remove retired menu/action records from installed Odoo 19 databases.

Odoo does not delete old XML records merely because they disappeared from a
module's data files. Do this on upgrade; preserve user-created submenus and all
stored company/branch printer assignments, print routes, jobs and history.
"""
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    root = env.ref("print_gateway.menu_print_gateway_main", raise_if_not_found=False)
    advanced = env.ref("print_gateway.menu_print_gateway_advanced", raise_if_not_found=False)
    if advanced and advanced.exists():
        # Preserve third-party/custom menus that were placed under Advanced.
        children = env["ir.ui.menu"].search([("parent_id", "=", advanced.id)])
        if children and not root:
            raise RuntimeError("Cannot reparent legacy Yaseir menus without the root menu")
        if children:
            children.write({"parent_id": root.id})
        advanced.unlink()
    printer_menu = env.ref("print_gateway.menu_print_gateway_printers", raise_if_not_found=False)
    if printer_menu and printer_menu.exists():
        printer_menu.unlink()
    old_action = env.ref("print_gateway.action_print_gateway_printers", raise_if_not_found=False)
    if old_action and old_action.exists():
        old_action.unlink()
