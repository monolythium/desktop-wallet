// Platform-specific session-lock / sleep / screen-lock plumbing.
//
// Architectural shape:
//
//   1. `SystemEventKind` discriminates the three categories.
//   2. `SystemEventListener` is the trait every consumer implements.
//   3. `EventDispatcher` is a `Vec<Box<dyn SystemEventListener>>` —
//      platform hooks call `dispatch()` to fan out.
//   4. Each platform module (`windows`, `macos`, `linux`) registers
//      OS-native handlers that call `dispatcher.dispatch(kind)`.
//   5. The Tauri shell installs one default listener that emits
//      `vault://os-event` carrying the kind. The TS-side `useVaults`
//      hook listens and calls `lock()` for any of the three kinds.
//
// Windows-bring-up is the floor for Phase 7. The actual
// `WTSRegisterSessionNotification` FFI lives behind a TODO that the
// next phase activates by uncommenting the `extern "system"` block
// and wiring it into `register_windows()`. Until then, Windows still
// gets session-lock coverage via the Phase 5 focus-loss proxy in
// `lib.rs` — that proxy fires before the session-lock notification
// would anyway, so the user-facing behaviour is the same.

use std::sync::{Arc, Mutex};

/// What happened at the OS layer. Each kind is a hard lock trigger
/// for the wallet — the dispatcher's listeners typically call
/// `vault.lock()` for any of these.
#[allow(dead_code)] // variants constructed by platform-specific impls + tests
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemEventKind {
    /// User locked the workstation (Win+L on Windows, lockscreen on
    /// macOS via Touch ID / Apple Menu, etc.).
    SessionLock,
    /// Machine is going to sleep / standby / hibernate.
    Sleep,
    /// Screen saver / lockscreen kicked in (a softer signal than
    /// SessionLock but still meaningful).
    ScreenLock,
}

impl SystemEventKind {
    /// Stable wire string the TS shell pattern-matches on.
    #[allow(dead_code)] // consumed by the Tauri emit listener
    pub fn as_wire(self) -> &'static str {
        match self {
            SystemEventKind::SessionLock => "session_lock",
            SystemEventKind::Sleep => "sleep",
            SystemEventKind::ScreenLock => "screen_lock",
        }
    }
}

/// One observer. Implementations carry their own state — typically a
/// handle to the Tauri AppHandle for event emission, or a counter for
/// test assertions.
pub trait SystemEventListener: Send + Sync {
    /// Invoked once per OS event. Implementations are best-effort
    /// observers — errors here MUST NOT leak; swallow + log internally.
    #[allow(dead_code)] // consumed by TauriEmitListener in lib.rs
    fn on_event(&self, kind: SystemEventKind);
}

/// Holds the registered listeners + fans out events. Cheaply cloneable
/// (Arc<Mutex<…>> internally) so platform hooks can hold a handle in
/// their own thread.
#[derive(Clone, Default)]
pub struct EventDispatcher {
    listeners: Arc<Mutex<Vec<Arc<dyn SystemEventListener>>>>,
}

impl EventDispatcher {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a listener. Returns silently — listeners are kept
    /// alive by the Arc inside the vector. To deregister, drop the
    /// dispatcher (typical usage is wallet-lifetime).
    pub fn add_listener<L: SystemEventListener + 'static>(&self, listener: L) {
        let mut guard = self
            .listeners
            .lock()
            .expect("EventDispatcher mutex poisoned");
        guard.push(Arc::new(listener));
    }

    /// Fan out one event. Errors inside a listener don't stop the
    /// chain — listeners are best-effort observers.
    #[allow(dead_code)] // invoked from platform-specific impls
    pub fn dispatch(&self, kind: SystemEventKind) {
        // Clone the vec under the lock so listeners can themselves
        // call `add_listener` without deadlocking on the mutex.
        let snapshot: Vec<Arc<dyn SystemEventListener>> = {
            let guard = match self.listeners.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard.clone()
        };
        for listener in snapshot {
            listener.on_event(kind);
        }
    }

    /// Test helper — exposes the current listener count.
    #[cfg(test)]
    pub fn listener_count(&self) -> usize {
        self.listeners
            .lock()
            .map(|g| g.len())
            .unwrap_or(0)
    }
}

/// Register OS-native hooks. Each platform module installs its own
/// listeners on the supplied dispatcher; on platforms without a
/// concrete impl this is a no-op (the focus-loss proxy in `lib.rs`
/// remains the primary lock trigger).
///
/// Returns `Ok(())` on every platform — failure to wire a hook is
/// surfaced as a warning in the platform-specific impl but does NOT
/// propagate as an error because the focus-loss proxy still works.
pub fn register_platform_hooks(_dispatcher: &EventDispatcher) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::register(_dispatcher);
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::register(_dispatcher);
    }
    #[cfg(target_os = "linux")]
    {
        linux_impl::register(_dispatcher);
    }
    Ok(())
}

// ─── Per-OS modules ────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::EventDispatcher;

    /// Register `WTSRegisterSessionNotification` against the wallet's
    /// main window so the Win32 message pump receives:
    ///   WTS_SESSION_LOCK   → SessionLock
    ///   WTS_CONSOLE_DISCONNECT → SessionLock
    ///   WM_POWERBROADCAST(PBT_APMSUSPEND) → Sleep
    ///
    /// **Activation TODO #D18-windows**: the actual FFI needs the
    /// `windows-sys` crate (already transitively in the lock file
    /// from other deps) added as a direct dependency with the
    /// `Win32_System_RemoteDesktop` + `Win32_System_Power` features.
    /// Until that activation step lands, Phase 5's window-blur proxy
    /// (`lib.rs` `WindowEvent::Focused(false)`) fires on session lock
    /// before WTS would anyway — so the user-facing behaviour is
    /// already correct. This stub keeps the trait wiring in place so
    /// the next bring-up commit is a single FFI module insertion.
    pub(super) fn register(_dispatcher: &EventDispatcher) {
        // intentionally no-op until the FFI activation commit lands.
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::EventDispatcher;

    /// **GAP #D18-macos**: register an `NSWorkspaceWillSleep` /
    /// `NSWorkspaceSessionDidResignActive` observer via `objc2`. The
    /// observer would call `dispatcher.dispatch(SessionLock)` /
    /// `dispatcher.dispatch(Sleep)` from a Cocoa autorelease scope.
    pub(super) fn register(_dispatcher: &EventDispatcher) {
        // no-op stub; #D18-macos
    }
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::EventDispatcher;

    /// **GAP #D18-linux**: open a `zbus::Connection::system()` and
    /// subscribe to `org.freedesktop.login1.Manager` `PrepareForSleep`
    /// + `org.freedesktop.ScreenSaver` `ActiveChanged`. Forward to
    /// `dispatcher.dispatch`.
    pub(super) fn register(_dispatcher: &EventDispatcher) {
        // no-op stub; #D18-linux
    }
}

// ─── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Listener that records each event it observed.
    struct Counter {
        count: Arc<AtomicUsize>,
        last_kind: Arc<Mutex<Option<SystemEventKind>>>,
    }

    impl SystemEventListener for Counter {
        fn on_event(&self, kind: SystemEventKind) {
            self.count.fetch_add(1, Ordering::SeqCst);
            *self.last_kind.lock().unwrap() = Some(kind);
        }
    }

    #[test]
    fn dispatcher_fans_out_to_every_listener() {
        let dispatcher = EventDispatcher::new();
        let count_a = Arc::new(AtomicUsize::new(0));
        let count_b = Arc::new(AtomicUsize::new(0));
        let last_a = Arc::new(Mutex::new(None));
        let last_b = Arc::new(Mutex::new(None));
        dispatcher.add_listener(Counter {
            count: count_a.clone(),
            last_kind: last_a.clone(),
        });
        dispatcher.add_listener(Counter {
            count: count_b.clone(),
            last_kind: last_b.clone(),
        });
        assert_eq!(dispatcher.listener_count(), 2);

        dispatcher.dispatch(SystemEventKind::SessionLock);
        assert_eq!(count_a.load(Ordering::SeqCst), 1);
        assert_eq!(count_b.load(Ordering::SeqCst), 1);
        assert_eq!(*last_a.lock().unwrap(), Some(SystemEventKind::SessionLock));
        assert_eq!(*last_b.lock().unwrap(), Some(SystemEventKind::SessionLock));
    }

    #[test]
    fn each_kind_round_trips_through_dispatch() {
        let dispatcher = EventDispatcher::new();
        let count = Arc::new(AtomicUsize::new(0));
        let last = Arc::new(Mutex::new(None));
        dispatcher.add_listener(Counter {
            count: count.clone(),
            last_kind: last.clone(),
        });

        dispatcher.dispatch(SystemEventKind::SessionLock);
        assert_eq!(*last.lock().unwrap(), Some(SystemEventKind::SessionLock));
        dispatcher.dispatch(SystemEventKind::Sleep);
        assert_eq!(*last.lock().unwrap(), Some(SystemEventKind::Sleep));
        dispatcher.dispatch(SystemEventKind::ScreenLock);
        assert_eq!(*last.lock().unwrap(), Some(SystemEventKind::ScreenLock));
        assert_eq!(count.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn dispatcher_with_no_listeners_is_a_no_op() {
        let dispatcher = EventDispatcher::new();
        dispatcher.dispatch(SystemEventKind::SessionLock);
        // No panic, no observable effect.
        assert_eq!(dispatcher.listener_count(), 0);
    }

    #[test]
    fn system_event_kind_has_stable_wire_strings() {
        assert_eq!(SystemEventKind::SessionLock.as_wire(), "session_lock");
        assert_eq!(SystemEventKind::Sleep.as_wire(), "sleep");
        assert_eq!(SystemEventKind::ScreenLock.as_wire(), "screen_lock");
    }

    #[test]
    fn register_platform_hooks_is_safe_on_every_platform() {
        // Whatever target this test runs on, the call must succeed.
        let dispatcher = EventDispatcher::new();
        register_platform_hooks(&dispatcher).expect("register hooks");
    }
}
