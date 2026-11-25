// Preguntas de confirmación propias (window.confirm queda técnico y no se puede diseñar).
import { shallowRef } from 'vue'

export interface ConfirmRequest {
  title: string
  message?: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export const confirmRequest = shallowRef<ConfirmRequest | null>(null)

export function askConfirm(options: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  // Si ya había una abierta, se da por cancelada.
  confirmRequest.value?.resolve(false)
  return new Promise((resolve) => {
    confirmRequest.value = {
      ...options,
      resolve: (ok) => {
        confirmRequest.value = null
        resolve(ok)
      },
    }
  })
}
