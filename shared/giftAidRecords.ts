export function isGiftAidOptOut(value: string | null | undefined): boolean {
  const opt = (value ?? '').trim().toUpperCase()
  return opt === '' || opt === 'N' || opt === 'NO'
}

type RecordConsent = {
  record_status: string
  gift_aid_opt_in: string | null
  gift_aid_submitted?: boolean | null
}

export function giftAidRecordGroup(record: RecordConsent) {
  if (record.record_status === 'incomplete') {
    return isGiftAidOptOut(record.gift_aid_opt_in) ? 'incomplete_opt_out' : 'incomplete_opt_in'
  }
  if (record.record_status === 'valid' && record.gift_aid_submitted === false) return 'historic'
  return record.record_status
}

export function userExportRecords<T extends RecordConsent>(records: T[], mode: 'full' | 'valid'): T[] {
  return mode === 'full' ? records : records.filter(record =>
    record.record_status === 'valid' && record.gift_aid_submitted !== false && !isGiftAidOptOut(record.gift_aid_opt_in)
  )
}
