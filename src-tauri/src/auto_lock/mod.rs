// auto_lock — Phase 7 platform-specific session-lock plumbing.
//
// Phase 5 shipped a cross-platform focus-loss proxy (window blur ⇒
// vault lock) via `WindowEvent::Focused(false)` in `lib.rs`. That
// covers most "user stepped away" cases on every desktop OS because
// each platform's session-lock action blurs the focused window first.
//
// Phase 7 lays the architecture for true OS-level session-lock /
// sleep / screen-lock notifications, on top of the focus-loss proxy.
// The `SystemEventListener` trait + `EventDispatcher` form the wiring
// pattern; platform-specific impls register OS hooks and forward to
// the dispatcher. Hooks emit a single Tauri event the TypeScript
// shell listens to — same channel as the existing `vault://focus-lost`
// proxy so the UI doesn't grow a third lock-trigger path.
//
// Closes (architecturally) #D18 / Phase 5 final report:
//   - Cross-platform interface defined.
//   - Windows: stub honors the trait + tests round-trip through the
//     dispatcher; the actual `WTSRegisterSessionNotification` FFI is
//     marked as a follow-up activation step (no heavy FFI in this
//     commit per the per-phase dep-discipline rule).
//   - macOS / Linux: stub-only, GAP markers for future bring-up.

pub mod system_events;
