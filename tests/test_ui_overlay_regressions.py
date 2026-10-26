"""UI overlay regressions that can run without frontend dependencies."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI = (ROOT / "src/components/ui.tsx").read_text(encoding="utf-8")
MENU = UI[UI.index("export function Menu({"):UI.index("export function Tabs<")]


def test_shared_menu_escapes_overflow_containers_and_uses_viewport_collision_handling():
    assert "createPortal(" in MENU
    assert "document.body" in MENU
    assert 'position: "fixed"' in MENU
    assert "roomBelow" in MENU and "roomAbove" in MENU
    assert 'resolvedPlacement = "above"' in MENU
    assert 'resolvedPlacement = "below"' in MENU
    assert 'max-w-[calc(100vw-1rem)]' in MENU
    assert "overflow-y-auto" in MENU


def test_portaled_menu_preserves_rtl_alignment_and_tracks_scroll_resize():
    assert 'direction === "rtl"' in MENU
    assert 'if (align === "end")' in MENU
    assert 'window.addEventListener("resize", onViewportChange)' in MENU
    assert 'window.addEventListener("scroll", onViewportChange, true)' in MENU
    assert "!rootRef.current?.contains(target) && !menuRef.current?.contains(target)" in MENU


def test_operational_row_action_surfaces_share_the_repaired_menu_primitive():
    consumers = [
        "src/app/dashboard/dashboard-client.tsx",
        "src/app/platform/tenants/page.tsx",
        "src/components/AppShell.tsx",
        "src/components/LanguageSwitcher.tsx",
    ]
    for relative in consumers:
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "<Menu" in source, relative


def test_workspace_team_directory_has_no_role_selector_or_mutation_menu():
    page = (ROOT / "src/app/team/page.tsx").read_text(encoding="utf-8")
    assert "<Select" not in page
    assert "<Menu" not in page
    assert "updateRole(" not in page
    assert "/api/team/invitations" not in page
    platform = (ROOT / "src/components/platform/PlatformTeamManagement.tsx").read_text(encoding="utf-8")
    assert "Button" in platform
    assert "/api/platform/auth/reauth" in platform
