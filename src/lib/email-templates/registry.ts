import type { ElementType } from "react";
import { template as signalAlertTemplate } from "./signal-alert";
import { template as accountCancellationTemplate } from "./account-cancellation";
import { template as accountCancellationAdminTemplate } from "./account-cancellation-admin";
import { template as feedbackReceivedTemplate } from "./feedback-received";
import { template as feedbackThankYouTemplate } from "./feedback-thank-you";
import { template as learningMilestoneTemplate } from "./learning-milestone";
import { template as modelReadinessTemplate } from "./model-readiness";
import { template as gateChangeAppliedTemplate } from "./gate-change-applied";
import { template as weeklyShadowReportTemplate } from "./weekly-shadow-report";
import { template as verifyTradePricesTemplate } from "./verify-trade-prices";

export interface TemplateEntry {
  component: ElementType;
  subject: string | ((data: Record<string, unknown>) => string);
  displayName?: string;
  previewData?: Record<string, unknown>;
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string;
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
  "signal-alert": signalAlertTemplate,
  "account-cancellation": accountCancellationTemplate,
  "account-cancellation-admin": accountCancellationAdminTemplate,
  "feedback-received": feedbackReceivedTemplate,
  "feedback-thank-you": feedbackThankYouTemplate,
  "learning-milestone": learningMilestoneTemplate,
  "model-readiness": modelReadinessTemplate,
  "gate-change-applied": gateChangeAppliedTemplate,
  "weekly-shadow-report": weeklyShadowReportTemplate,
  "verify-trade-prices": verifyTradePricesTemplate,
};
