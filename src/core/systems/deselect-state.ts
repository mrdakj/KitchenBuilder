// Shared state so a pending "click-empty-to-deselect" can be cancelled
// by a subsequent double-click that enters move mode.
export const deselectState = {
  pendingTimeoutId: null as ReturnType<typeof setTimeout> | null,
  cancel() {
    if (this.pendingTimeoutId != null) {
      clearTimeout(this.pendingTimeoutId)
      this.pendingTimeoutId = null
    }
  },
}

// Flag the 3D viewer uses to suppress selection/deselection/placement
// while the user is in double-click-to-move mode.
export const moveMode = {
  active: false,
}
