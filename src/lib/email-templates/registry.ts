import type { ComponentType } from 'react'
import { template as signalAlertTemplate } from './signal-alert'
import { template as accountCancellationTemplate } from './account-cancellation'
import { template as accountCancellationAdminTemplate } from './account-cancellation-admin'
import { template as feedbackReceivedTemplate } from './feedback-received'
import { template as feedbackThankYouTemplate } from './feedback-thank-you'
import { template as learningMilestoneTemplate } from './learning-milestone'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'signal-alert': signalAlertTemplate,
  'account-cancellation': accountCancellationTemplate,
  'account-cancellation-admin': accountCancellationAdminTemplate,
  'feedback-received': feedbackReceivedTemplate,
  'feedback-thank-you': feedbackThankYouTemplate,
}
