import { useEffect } from 'react'
import { gsap } from 'gsap'

/** A brief release animation for mouse, touch, and keyboard button activation. */
export function useInteractionMotion() {
  useEffect(() => {
    const motion = gsap.matchMedia()
    motion.add('(prefers-reduced-motion: no-preference)', () => {
      const running = new Set<gsap.core.Tween>()
      const press = (event: MouseEvent) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null
        if (!(button instanceof HTMLButtonElement) || button.disabled || button.getAttribute('aria-disabled') === 'true') return
        const tween = gsap.fromTo(button, { scale: .96 }, {
          scale: 1, duration: .32, ease: 'back.out(1.6)', overwrite: 'auto',
          clearProps: 'transform',
          onComplete: () => running.delete(tween),
          onInterrupt: () => running.delete(tween),
        })
        running.add(tween)
      }
      document.addEventListener('click', press, true)
      return () => {
        document.removeEventListener('click', press, true)
        running.forEach(tween => tween.revert())
        running.clear()
      }
    })
    return () => motion.revert()
  }, [])
}
