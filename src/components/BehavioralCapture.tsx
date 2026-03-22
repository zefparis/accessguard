import { useEffect, type ReactNode } from 'react'
import { useBehavioral, type BehavioralController } from '../hooks/useBehavioral'

type Props = {
  onController: (controller: BehavioralController) => void
  children: ReactNode
}

export function BehavioralCapture({ onController, children }: Props) {
  const controller = useBehavioral()

  useEffect(() => {
    onController(controller)
    void controller.start()
    return () => {
      controller.stop()
    }
  }, [controller, onController])

  return <>{children}</>
}
