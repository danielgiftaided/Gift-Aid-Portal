export function isGiftAidOptOut(value: string | null | undefined): boolean {
  const opt = (value ?? '').trim().toUpperCase()
  return opt === '' || opt === 'N' || opt === 'NO'
}

type RecordConsent = {
  record_status: string
  gift_aid_opt_in: string | null
  gift_aid_submitted?: boolean | null
}

export function isOptOutRecord(record: RecordConsent): boolean {
  return record.record_status === 'opt_out' || isGiftAidOptOut(record.gift_aid_opt_in)
}

export function isValidGiftAidRecord(record: RecordConsent): boolean {
  return record.record_status === 'valid' && record.gift_aid_submitted !== false && !isOptOutRecord(record)
}

export function missedGiftAidRecords<T extends RecordConsent>(records: T[]): T[] {
  // A row that is both incomplete and opted out enters this union once.
  return records.filter(record => record.record_status === 'incomplete' || isOptOutRecord(record))
}

export function giftAidRecordGroup(record: RecordConsent) {
  if (record.record_status === 'incomplete') {
    return isGiftAidOptOut(record.gift_aid_opt_in) ? 'incomplete_opt_out' : 'incomplete_opt_in'
  }
  if (isOptOutRecord(record)) return 'opt_out'
  if (record.record_status === 'valid' && record.gift_aid_submitted === false) return 'historic'
  return record.record_status
}

export function userExportRecords<T extends RecordConsent>(records: T[], mode: 'full' | 'valid'): T[] {
  return mode === 'full' ? records : records.filter(isValidGiftAidRecord)
}
