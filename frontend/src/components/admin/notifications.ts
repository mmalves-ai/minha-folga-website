import type { AdminRole } from './types'

export interface NotificationDelivery {
  pending: number
  sending: number
  accepted: number
  failed: number
  expired: number
  cancelled: number
}
export interface NotificationCampaign {
  id: string
  title: string
  body: string
  url: string
  audienceCount: number
  createdBy: string
  createdAt: string
  cancelled: boolean
  delivery: NotificationDelivery
}
export interface AdminNotifications {
  enabled: boolean
  subscribers: number
  dailyCampaignCap: number
  destinations: string[]
  campaigns: NotificationCampaign[]
}
export interface NotificationGrant {
  id: string
  displayName: string
  role: AdminRole
  disabled: boolean
  allowed: boolean
  grantedAt: string | null
}
export interface NotificationQueued {
  status: 'queued'
  campaignId: string
  audienceCount: number
}
