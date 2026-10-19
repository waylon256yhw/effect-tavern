// Deckled's composer keyboard controller (model/composer-keyboard.ts), verbatim in substance. Keep IME state apart from
// KeyboardEvent.isComposing: WebKit can end the composition before dispatching the Enter keydown that confirmed it, so the
// first Enter after compositionend still belongs to the IME for one task. Submit is ⌘↵ / Ctrl↵; bare Enter is a newline.
export const imeController = (submit: () => boolean) => {
  let composing = false
  let justEnded = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return {
    compositionStart: () => {
      clear()
      composing = true
      justEnded = false
    },
    compositionEnd: () => {
      clear()
      composing = false
      justEnded = true
      timer = setTimeout(() => {
        justEnded = false
        timer = undefined
      }, 0)
    },
    keyDown: (e: KeyboardEvent): boolean => {
      const modEnter = (e.metaKey || e.ctrlKey) && e.key === "Enter"
      if (!modEnter || e.isComposing || e.keyCode === 229 || composing || justEnded) return false
      if (!submit()) return false
      e.preventDefault()
      return true
    },
    dispose: clear,
  }
}
