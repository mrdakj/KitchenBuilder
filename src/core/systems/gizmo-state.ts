// Module-level flag set by SelectionGizmo around TransformControls drags
// and pointer hover. ToolOverlay3D reads it to avoid deselecting the node
// when the user is interacting with the gizmo.
export const gizmoState = {
  dragging: false,
  hoveringAxis: false,
}
