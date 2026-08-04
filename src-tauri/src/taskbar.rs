#[cfg(target_os = "windows")]
pub mod taskbar_windows {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::Win32::Foundation::{BOOL, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateBitmap, GetDC, ReleaseDC, DeleteObject};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        TaskbarList, ITaskbarList3, SetWindowSubclass, THUMBBUTTON,
        THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconIndirect, ICONINFO, WM_COMMAND,
    };

    static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
    static IS_PLAYING: AtomicBool = AtomicBool::new(false);

    const BTN_LIKE: u32 = 100;
    const BTN_PREV: u32 = 101;
    const BTN_PLAY: u32 = 102;
    const BTN_NEXT: u32 = 103;

    pub fn setup_taskbar_buttons(app_handle: AppHandle) {
        let _ = APP_HANDLE.set(app_handle.clone());

        if let Some(window) = app_handle.get_webview_window("main") {
            if let Ok(raw_hwnd) = window.hwnd() {
                let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as *mut _);
                unsafe {
                    let _ = SetWindowSubclass(hwnd, Some(subclass_proc), 4242, 0);
                    init_thumb_buttons(hwnd, false);
                }
            }
        }
    }

    pub fn update_playback_state(app_handle: &AppHandle, is_playing: bool) {
        IS_PLAYING.store(is_playing, Ordering::Relaxed);
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Ok(raw_hwnd) = window.hwnd() {
                let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as *mut _);
                unsafe {
                    init_thumb_buttons(hwnd, is_playing);
                }
            }
        }
    }

    unsafe fn create_rgba_icon(width: i32, height: i32, draw_fn: impl Fn(i32, i32) -> bool) -> windows::Win32::UI::WindowsAndMessaging::HICON {
        let mut bgra = vec![0u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in 0..width {
                if draw_fn(x, y) {
                    let idx = ((y * width + x) * 4) as usize;
                    bgra[idx] = 255;     // B
                    bgra[idx + 1] = 255; // G
                    bgra[idx + 2] = 255; // R
                    bgra[idx + 3] = 255; // A
                }
            }
        }

        let hdc_screen = GetDC(windows::Win32::Foundation::HWND(std::ptr::null_mut()));
        let hbm_color = CreateBitmap(width, height, 1, 32, Some(bgra.as_ptr() as *const _));
        let hbm_mask = CreateBitmap(width, height, 1, 1, None);

        let icon_info = ICONINFO {
            fIcon: BOOL(1),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: hbm_mask,
            hbmColor: hbm_color,
        };

        let hicon = CreateIconIndirect(&icon_info).unwrap_or_default();
        let _ = DeleteObject(hbm_color);
        let _ = DeleteObject(hbm_mask);
        let _ = ReleaseDC(windows::Win32::Foundation::HWND(std::ptr::null_mut()), hdc_screen);

        hicon
    }

    unsafe fn init_thumb_buttons(hwnd: windows::Win32::Foundation::HWND, is_playing: bool) {
        let taskbar: Result<ITaskbarList3, _> = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER);
        if let Ok(taskbar) = taskbar {
            if taskbar.HrInit().is_ok() {
                // Button 0: Plus (Like / Add)
                let icon_like = create_rgba_icon(16, 16, |x, y| {
                    (x == 7 || x == 8) && (y >= 2 && y <= 13) || (y == 7 || y == 8) && (x >= 2 && x <= 13)
                });

                // Button 1: Prev (|<)
                let icon_prev = create_rgba_icon(16, 16, |x, y| {
                    (x >= 2 && x <= 3 && y >= 2 && y <= 13) || (x >= 4 && x <= 12 && (y >= (14 - x) && y <= x))
                });

                // Button 2: Play or Pause
                let icon_play = if is_playing {
                    // Pause (||)
                    create_rgba_icon(16, 16, |x, y| {
                        ((x >= 4 && x <= 6) || (x >= 9 && x <= 11)) && (y >= 2 && y <= 13)
                    })
                } else {
                    // Play (>)
                    create_rgba_icon(16, 16, |x, y| {
                        x >= 3 && x <= 13 && (y >= (15 - x) && y <= x)
                    })
                };

                // Button 3: Next (>|)
                let icon_next = create_rgba_icon(16, 16, |x, y| {
                    (x >= 12 && x <= 13 && y >= 2 && y <= 13) || (x >= 3 && x <= 11 && (y >= x && y <= (15 - x)))
                });

                let buttons = [
                    THUMBBUTTON {
                        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
                        iId: BTN_LIKE,
                        iBitmap: 0,
                        hIcon: icon_like,
                        szTip: to_sz_tip("Like"),
                        dwFlags: THBF_ENABLED,
                    },
                    THUMBBUTTON {
                        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
                        iId: BTN_PREV,
                        iBitmap: 1,
                        hIcon: icon_prev,
                        szTip: to_sz_tip("Previous"),
                        dwFlags: THBF_ENABLED,
                    },
                    THUMBBUTTON {
                        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
                        iId: BTN_PLAY,
                        iBitmap: 2,
                        hIcon: icon_play,
                        szTip: to_sz_tip(if is_playing { "Pause" } else { "Play" }),
                        dwFlags: THBF_ENABLED,
                    },
                    THUMBBUTTON {
                        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
                        iId: BTN_NEXT,
                        iBitmap: 3,
                        hIcon: icon_next,
                        szTip: to_sz_tip("Next"),
                        dwFlags: THBF_ENABLED,
                    },
                ];

                // Try AddFirst, if already added update
                let res = taskbar.ThumbBarAddButtons(hwnd, &buttons);
                if res.is_err() {
                    let _ = taskbar.ThumbBarUpdateButtons(hwnd, &buttons);
                }
            }
        }
    }

    fn to_sz_tip(s: &str) -> [u16; 260] {
        let mut buf = [0u16; 260];
        let utf16: Vec<u16> = s.encode_utf16().collect();
        let len = utf16.len().min(259);
        buf[..len].copy_from_slice(&utf16[..len]);
        buf
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: windows::Win32::Foundation::HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id_subclass: usize,
        _ref_data: usize,
    ) -> LRESULT {
        if msg == WM_COMMAND {
            let cmd = (wparam.0 >> 16) as u32; // HIWORD
            let btn_id = (wparam.0 & 0xffff) as u32; // LOWORD
            
            // 0x1800 is THBN_CLICKED
            if cmd == 0x1800 || cmd == 0 {
                if let Some(app) = APP_HANDLE.get() {
                    match btn_id {
                        BTN_LIKE => {
                            let _ = app.emit("taskbar-like", ());
                        }
                        BTN_PREV => {
                            let _ = app.emit("shortcut-prev", ());
                        }
                        BTN_PLAY => {
                            let _ = app.emit("shortcut-play-pause", ());
                        }
                        BTN_NEXT => {
                            let _ = app.emit("shortcut-next", ());
                        }
                        _ => {}
                    }
                }
            }
        }
        windows::Win32::UI::Shell::DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}
