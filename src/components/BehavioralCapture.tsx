import { useEffect, type ReactNode } from 'react'
import { useBehavioral, type BehavioralController } from '../hooks/useBehavioral'

type Props = {
  enabled?: boolean
  onController: (controller: BehavioralController) => void
  children: ReactNode
}

export function BehavioralCapture({ enabled = true, onController, children }: Props) {
  const controller = useBehavioral()

  useEffect(() => {
    onController(controller)

    if (enabled) {
      void controller.start()
    } else {
      controller.stop()
    }

    return () => {
      controller.stop()
    }
  }, [controller, enabled, onController])

  return <>{children}</>
}
