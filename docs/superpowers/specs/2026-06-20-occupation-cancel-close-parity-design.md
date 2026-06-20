## Goal

Make the occupation selector's `Cancel` button behave exactly like closing the dialog with `X`.

## Current Behavior

Closing the occupation selector through the window close button causes the selector prompt to resolve as a cancelled selection. The occupation auto-apply flow then deletes the temporary occupation item and shows the cancellation notification.

Clicking the `Cancel` button does not consistently follow that same path. The dialog exits, but the selector result is not always interpreted as a cancelled selection by the auto-apply flow, leaving the occupation item on the actor without the existing cancellation warning.

## Design

Keep the cancellation behavior centralized in `applyOccupationFromItem()`, which already handles a cancelled selection correctly.

Update `promptOccupationSelections()` so it normalizes all cancel-like dialog outcomes to `null`, including:

- dialog close via `X`
- explicit `Cancel` button actions
- any falsey dialog result

This keeps the UI layer responsible only for shaping dialog output and preserves a single cancellation path in the automation layer.

## Testing

Add a focused unit test for the selection-dialog result normalization so `Cancel` and `Close` both resolve to `null`, while valid selection payloads continue unchanged.
