//! Administrator-only startup gate.
//!
//! The Print Agent manages a Windows service and machine-wide printer
//! state, so the manager app must run with a full administrator token.
//! `enforce_administrator_or_exit` is the FIRST statement of `main()`:
//! before the single-instance mutex, before logging, before the tray,
//! and before any Tauri setup. A non-elevated launch shows one native
//! dialog whose single action is "Restart as Administrator": choosing
//! it launches an elevated copy (UAC prompt) and this process exits
//! immediately; dismissing the dialog exits without launching anything.
//! A non-elevated process NEVER continues past this gate — nothing else
//! has started, so there is no tray, listener, or background work to
//! clean up.

#[cfg(windows)]
pub fn enforce_administrator_or_exit() {
    if crate::commands::is_running_as_admin() {
        return;
    }
    if show_admin_required_dialog() {
        // The user chose "Restart as Administrator": hand off to the
        // elevated copy and close this one either way. Exit 0 only when
        // the elevated replacement actually launched.
        match crate::commands::relaunch_as_admin() {
            Ok(()) => std::process::exit(0),
            Err(_) => std::process::exit(1),
        }
    }
    std::process::exit(1);
}

#[cfg(not(windows))]
pub fn enforce_administrator_or_exit() {}

#[cfg(windows)]
fn system_ui_is_arabic() -> bool {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
    }
    // LANGID: low 10 bits are the primary language; LANG_ARABIC = 0x01.
    unsafe { GetUserDefaultUILanguage() & 0x03FF == 0x01 }
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

/// Shows the administrator-required dialog and returns true only when
/// the user chose its single action, "Restart as Administrator".
#[cfg(windows)]
fn show_admin_required_dialog() -> bool {
    use std::ffi::c_void;

    type HANDLE = *mut c_void;

    #[repr(C)]
    struct TaskDialogButton {
        n_button_id: i32,
        psz_button_text: *const u16,
    }

    // TASKDIALOGCONFIG (comctl32). The two icon unions are represented
    // by their pointer-sized form; TD_WARNING_ICON is passed as a
    // MAKEINTRESOURCE pointer value.
    #[repr(C)]
    struct TaskDialogConfig {
        cb_size: u32,
        hwnd_parent: HANDLE,
        h_instance: HANDLE,
        dw_flags: u32,
        dw_common_buttons: u32,
        psz_window_title: *const u16,
        psz_main_icon: *const u16,
        psz_main_instruction: *const u16,
        psz_content: *const u16,
        c_buttons: u32,
        p_buttons: *const TaskDialogButton,
        n_default_button: i32,
        c_radio_buttons: u32,
        p_radio_buttons: *const TaskDialogButton,
        n_default_radio_button: i32,
        psz_verification_text: *const u16,
        psz_expanded_information: *const u16,
        psz_expanded_control_text: *const u16,
        psz_collapsed_control_text: *const u16,
        psz_footer_icon: *const u16,
        psz_footer: *const u16,
        pf_callback: *const c_void,
        lp_callback_data: isize,
        cx_width: u32,
    }

    #[link(name = "comctl32")]
    unsafe extern "system" {
        fn TaskDialogIndirect(
            config: *const TaskDialogConfig,
            button: *mut i32,
            radio_button: *mut i32,
            verification_flag_checked: *mut i32,
        ) -> i32;
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(hwnd: HANDLE, text: *const u16, caption: *const u16, u_type: u32) -> i32;
    }

    const TD_WARNING_ICON: *const u16 = 0xFFFE as *const u16; // MAKEINTRESOURCE(-2)
    const TDF_ALLOW_DIALOG_CANCELLATION: u32 = 0x0008;
    const RESTART_BUTTON_ID: i32 = 1001;
    const IDOK: i32 = 1;
    const MB_OK: u32 = 0x0000_0000;
    const MB_ICONWARNING: u32 = 0x0000_0030;
    const MB_SETFOREGROUND: u32 = 0x0001_0000;

    let arabic = system_ui_is_arabic();
    let (instruction, content, restart_label) = if arabic {
        (
            "صلاحيات المسؤول مطلوبة",
            "لازم تشغّل التطبيق بصلاحيات المسؤول (Run as administrator) عشان يشتغل. اضغط «إعادة الفتح كمسؤول» وهنقفل النسخة دي ونفتح التطبيق من جديد بصلاحيات المسؤول.",
            "إعادة الفتح كمسؤول",
        )
    } else {
        (
            "Administrator privileges are required",
            "This application must be run as administrator (Run as administrator) to work. Choose “Restart as Administrator” and this copy will close and reopen with administrator privileges.",
            "Restart as Administrator",
        )
    };
    let title = wide("Yaseir Print Manager");
    let instruction = wide(instruction);
    let content = wide(content);
    let restart_label = wide(restart_label);

    let buttons = [TaskDialogButton {
        n_button_id: RESTART_BUTTON_ID,
        psz_button_text: restart_label.as_ptr(),
    }];
    let config = TaskDialogConfig {
        cb_size: std::mem::size_of::<TaskDialogConfig>() as u32,
        hwnd_parent: std::ptr::null_mut(),
        h_instance: std::ptr::null_mut(),
        dw_flags: TDF_ALLOW_DIALOG_CANCELLATION,
        dw_common_buttons: 0,
        psz_window_title: title.as_ptr(),
        psz_main_icon: TD_WARNING_ICON,
        psz_main_instruction: instruction.as_ptr(),
        psz_content: content.as_ptr(),
        c_buttons: 1,
        p_buttons: buttons.as_ptr(),
        n_default_button: RESTART_BUTTON_ID,
        c_radio_buttons: 0,
        p_radio_buttons: std::ptr::null(),
        n_default_radio_button: 0,
        psz_verification_text: std::ptr::null(),
        psz_expanded_information: std::ptr::null(),
        psz_expanded_control_text: std::ptr::null(),
        psz_collapsed_control_text: std::ptr::null(),
        psz_footer_icon: std::ptr::null(),
        psz_footer: std::ptr::null(),
        pf_callback: std::ptr::null(),
        lp_callback_data: 0,
        cx_width: 0,
    };
    let mut pressed: i32 = 0;
    let hr = unsafe {
        TaskDialogIndirect(
            &config,
            &mut pressed,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if hr == 0 {
        return pressed == RESTART_BUTTON_ID;
    }
    // Fallback: a single-OK-button message box whose text states that
    // OK restarts the application as administrator, so IDOK carries
    // the same meaning as the task dialog's restart button.
    let result = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            content.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONWARNING | MB_SETFOREGROUND,
        )
    };
    result == IDOK
}
