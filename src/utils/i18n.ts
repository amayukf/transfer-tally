/**
 * Tiny two-language dictionary for the app UI (English / Amharic).
 *
 * Keeping it dependency-free on purpose: the app ships a single screen, so a
 * full i18n library would be more configuration than value. Every user-facing
 * string lives here and is read through `translate()`.
 */

export type Language = 'en' | 'am';

export const LANGUAGE_STORAGE_KEY = 'tt_language';

interface Entry {
  en: string;
  am: string;
}

const DICT: Record<string, Entry> = {
  /* Header */
  'header.toggleThemeTitle': { en: 'Toggle light / dark mode', am: 'የብርሃን/ጨለማ ገጽታ ቀይር' },
  'header.toggleLanguageTitle': { en: 'Switch language', am: 'ቋንቋ ቀይር' },

  /* Sticky total bar */
  'total.label': {
    en: 'Day Total (Excluding Duplicates)',
    am: 'የዕለቱ ድምር (ድግግሞሽ ሳይጨምር)',
  },
  'total.transfer': { en: 'transfer', am: 'ዝውውር' },
  'total.transfers': { en: 'transfers', am: 'ዝውውሮች' },
  'total.dupExcluded': { en: '{n} dup excluded', am: '{n} ድግግሞሽ ተገልሏል' },
  'total.missingRef': { en: '{n} missing ref', am: '{n} ማጣቀሻ የለም' },
  'total.nonReceipt': { en: '{n} not a receipt', am: '{n} ደረሰኝ አይደለም' },
  'total.reviewNeeded': { en: '{n} review needed', am: '{n} እይታ ይፈልጋል' },

  /* Navigation tabs */
  'nav.batch': { en: 'Today\u2019s Batch', am: 'የዛሬ ስብስብ' },
  'nav.history': { en: 'History', am: 'ታሪክ' },

  /* Upload card */
  'upload.title': { en: 'Upload Transfer Screenshots', am: 'የዝውውር ስክሪንሾት ይጫኑ' },
  'upload.subtitle': {
    en: 'Telebirr, CBE, Awash, or any Ethiopian mobile money receipt',
    am: 'ቴሌብር፣ CBE፣ አዋሽ ወይም ማንኛውም የኢትዮጵያ የሞባይል ገንዘብ ደረሰኝ',
  },
  'upload.pick': { en: 'Pick Screenshots', am: 'ስክሪንሾት ይምረጡ' },
  'upload.camera': { en: 'Take Photo', am: 'ፎቶ ያንሱ' },
  'upload.shareHint': {
    en: 'Or share straight from your gallery: select the screenshots \u2192 Share \u2192 Transfer Tally.',
    am: 'ወይም ከጋለሪዎ በቀጥታ ያጋሩ፦ ስክሪንሾቹን ይምረጡ \u2192 Share \u2192 Transfer Tally።',
  },
  'scanMode.label': { en: 'Scan mode', am: 'የስካን ዘዴ' },
  'scanMode.hybrid': {
    en: 'On-device + AI fallback (best accuracy)',
    am: 'በመሣሪያው ላይ + AI አማራጭ (ከፍተኛ ትክክለኛነት)',
  },
  'scanMode.onDevice': {
    en: 'On-device only (no AI, private)',
    am: 'በመሣሪያው ላይ ብቻ (AI የለም፣ ሚስጥራዊ)',
  },
  'scanMode.ai': { en: 'AI only', am: 'AI ብቻ' },

  /* Progress */
  'progress.title': { en: 'Processing Receipts', am: 'ደረሰኞችን በማስኬድ ላይ' },
  'progress.of': { en: '{a} of {b}', am: '{a} ከ{b}' },
  'progress.rateLimited': {
    en: '\u23f3 Extraction service is busy. Waiting before retry\u2026',
    am: '\u23f3 አገልግሎቱ ሥራ ላይ ነው። ከመደገም በፊት በመጠበቅ ላይ\u2026',
  },

  /* Batch list header + actions */
  'list.title': { en: 'Receipt List', am: 'የደረሰኞች ዝርዝር' },
  'list.items': { en: '({n} items)', am: '({n} ዝርዝሮች)' },
  'list.dateTitle': { en: 'Select date for this tally', am: 'ለዚህ ድምር ቀን ይምረጡ' },
  'list.refPrefix': { en: 'Ref:', am: 'ማጣቀሻ:' },
  'actions.saveDay': { en: 'Save Day', am: 'ቀኑን ያስቀምጡ' },
  'actions.exportCsv': { en: 'Export CSV', am: 'CSV ያውጡ' },
  'actions.clearBatch': { en: 'Clear batch', am: 'ስብስቡን አጽዳ' },

  /* Empty states */
  'empty.batchTitle': { en: 'No transfers in current batch', am: 'በአሁኑ ስብስብ ውስጥ ዝውውር የለም' },
  'empty.batchBody': {
    en: 'Upload or photograph your customers\u2019 transfer screenshots above. Telebirr, CBE, Awash and other Ethiopian receipts are read automatically, duplicates are excluded, and the day\u2019s total is calculated for you.',
    am: 'ከላይ የደንበኞችዎን የዝውውር ስክሪንሾት ይጫኑ ወይም ፎቶ ያንሱ። ቴሌብር፣ CBE፣ አዋሽ እና ሌሎች የኢትዮጵያ ደረሰኞች በራስ-ሰር ይነበባሉ፣ ድግግሞሾች ይገለላሉ፣ የቀኑም ድምር ለእርስዎ ይሰላል።',
  },

  /* Transfer card */
  'card.unknownBank': { en: 'Unknown Bank', am: 'ያልታወቀ ባንክ' },
  'card.noDate': { en: 'No date', am: 'ቀን የለም' },
  'badge.duplicate': { en: '\u26a0\ufe0f Duplicate (Excluded)', am: '\u26a0\ufe0f ድግግሞሽ (ተገልሏል)' },
  'badge.notReceipt': {
    en: '\ud83d\udeab Not a Receipt (Excluded)',
    am: '\ud83d\udeab ደረሰኝ አይደለም (ተገልሏል)',
  },
  'badge.needsRef': {
    en: '\u26a0\ufe0f Needs Ref (Excluded)',
    am: '\u26a0\ufe0f ማጣቀሻ ይፈልጋል (ተገልሏል)',
  },
  'badge.high': { en: '\u2713 High', am: '\u2713 ከፍተኛ' },
  'badge.medium': { en: '\u2022 Medium', am: '\u2022 መካከለኛ' },
  'badge.low': { en: '\u26a0\ufe0f Low Confidence', am: '\u26a0\ufe0f ዝቅተኛ እርግጠኝነት' },
  'currency': { en: 'ETB', am: 'ብር' },
  'card.amount': { en: 'AMOUNT (ETB)', am: 'መጠን (ብር)' },
  'card.reference': { en: 'Reference No (Txn ID)', am: 'የግብይት ቁጥር (ማጣቀሻ)' },
  'card.sender': { en: 'Sender (Payer)', am: 'ላኪ (ከፋይ)' },
  'card.receiver': { en: 'Receiver (Beneficiary)', am: 'ተቀባይ' },
  'card.status': { en: 'Receipt Status', am: 'የደረሰኝ ሁኔታ' },
  'card.confirmed': { en: 'Payment Confirmed', am: 'ክፍያ ተረጋግጧል' },
  'card.notReceiptExcluded': {
    en: 'Not a receipt (Excluded)',
    am: 'ደረሰኝ አይደለም (ተገልሏል)',
  },
  'card.emptyRef': { en: '(Empty - Needs Review)', am: '(ባዶ - እይታ ይፈልጋል)' },
  'card.viewReceipt': { en: 'View Receipt', am: 'ደረሰኙን ይመልከቱ' },
  'card.edit': { en: 'Edit', am: 'አርትዕ' },
  'card.delete': { en: 'Delete', am: 'አጥፋ' },
  'card.deleteTitle': { en: 'Delete this row', am: 'ይህን ረድፍ አጥፋ' },

  /* History */
  'history.title': { en: 'Saved Day Archives', am: 'የተቀመጡ ቀናት' },
  'history.storage': { en: 'Stored in browser localStorage', am: 'በአሳሹ ውስጥ ተቀምጧል' },
  'history.emptyTitle': { en: 'No saved days yet', am: 'እስካሁን የተቀመጠ ቀን የለም' },
  'history.emptyBody': {
    en: 'At the end of the day, tap \u201cSave Day\u201d in the batch tab to archive that day\u2019s transfers and total amount.',
    am: 'በቀኑ መጨረሻ «ቀኑን ያስቀምጡ» ን በመንካት የዚያን ቀን ዝውውሮችና ጠቅላላ ያስቀምጡ።',
  },
  'history.validTransfers': { en: '{n} valid transfers', am: '{n} ዝውውሮች' },
  'history.duplicates': { en: '{n} duplicates', am: '{n} ድግግሞሾች' },
  'history.imagesRemoved': { en: 'Images removed for quota', am: 'ምስሎች በማከማቻ ገደብ ተወግደዋል' },
  'history.hideDetails': { en: 'Hide Details', am: 'ዝርዝር ደብቅ' },
  'history.expand': { en: 'Expand', am: 'አስፋ' },
  'history.csv': { en: 'CSV', am: 'CSV' },
  'history.loadToEditor': { en: 'Load to Editor', am: 'ወደ አርታኢ ጫን' },
  'history.duplicateTag': { en: '(Duplicate)', am: '(ድግግሞሽ)' },
  'history.missingRefTag': { en: '(Missing Ref)', am: '(ማጣቀሻ የለም)' },
  'history.notReceiptTag': { en: '(Not a receipt)', am: '(ደረሰኝ አይደለም)' },
  'history.emptyRef': { en: '(Empty)', am: '(ባዶ)' },

  /* Edit modal */
  'modal.editTitle': { en: 'Edit Transfer', am: 'ዝውውር አርትዕ' },
  'form.bank': { en: 'Bank / Mobile Money Provider', am: 'ባንክ / የሞባይል ገንዘብ አገልግሎት' },
  'form.amount': { en: 'Transferred Amount (ETB)', am: 'የተላለፈ መጠን (ብር)' },
  'form.reference': { en: 'Reference Number (Txn ID)', am: 'የግብይት ቁጥር (ማጣቀሻ)' },
  'form.referencePlaceholder': { en: 'e.g. TLB88941203', am: 'ለምሳሌ፦ TLB88941203' },
  'form.sender': { en: 'Sender Name (Payer)', am: 'የላኪ ስም (ከፋይ)' },
  'form.receiver': { en: 'Receiver Name', am: 'የተቀባይ ስም' },
  'form.dateTime': { en: 'Date / Time', am: 'ቀን / ሰዓት' },
  'form.isReceipt': { en: 'Is this a payment receipt?', am: 'ይህ የክፍያ ደረሰኝ ነው?' },
  'form.isReceiptYes': { en: 'Yes \u2014 count in the total', am: 'አዎ \u2014 በድምሩ ውስጥ ይቆጠር' },
  'form.isReceiptNo': {
    en: 'No \u2014 not a receipt (excluded)',
    am: 'አይ \u2014 ደረሰኝ አይደለም (ተገልሏል)',
  },
  'form.confidence': { en: 'Confidence', am: 'እርግጠኝነት' },
  'form.confidenceHigh': { en: 'High (Certain)', am: 'ከፍተኛ (የተረጋገጠ)' },
  'form.confidenceMedium': { en: 'Medium', am: 'መካከለኛ' },
  'form.confidenceLow': { en: 'Low (Needs verification)', am: 'ዝቅተኛ (ማረጋገጫ ይፈልጋል)' },
  'form.save': { en: 'Save Changes', am: 'ለውጦችን ያስቀምጡ' },
  'form.cancel': { en: 'Cancel', am: 'ሰርዝ' },
  'preview.aria': { en: 'Receipt preview', am: 'የደረሰኝ ቅድመ-እይታ' },
  'preview.noRef': { en: 'No ref', am: 'ማጣቀሻ የለም' },
  'preview.refTitle': { en: '{bank} - Ref: {ref}', am: '{bank} - ማጣቀሻ: {ref}' },

  /* Toasts */
  'toast.invalidImage': {
    en: 'Skipped {name}: not a valid image.',
    am: '{name} ተዘለለ፦ ትክክለኛ ምስል አይደለም።',
  },
  'toast.tooLarge': { en: 'Skipped {name}: over 15MB', am: '{name} ተዘለለ፦ ከ15MB በላይ ነው' },
  'toast.batchSummary': {
    en: 'Added {n} images: {counted} transfer(s) + {nonReceipt} non-receipt(s) excluded.',
    am: '{n} ምስሎች ተጨመሩ፦ {counted} ዝውውር + {nonReceipt} ደረሰኝ-ያልሆኑ ተገልለዋል።',
  },
  'toast.batchAdded': { en: 'Added {n} transfer(s) to the batch.', am: '{n} ዝውውሮች ወደ ስብስቡ ተጨመሩ።' },
  'toast.sharedReceived': {
    en: 'Received {n} shared image(s). Scanning\u2026',
    am: '{n} የተጋሩ ምስሎች ተቀብለናል። በመስካን ላይ\u2026',
  },
  'toast.sharedError': {
    en: 'Could not receive the shared images \u2014 use Pick Screenshots instead.',
    am: 'የተጋሩትን ምስሎች ማግኘት አልቻልንም \u2014 «ስክሪንሾት ይምረጡ» ይጠቀሙ።',
  },
  'toast.sharedImportFailed': {
    en: 'Could not import the shared images.',
    am: 'የተጋሩትን ምስሎች ማስገባት አልቻልንም።',
  },
  'toast.nothingToSave': { en: 'No transfers to save.', am: 'ለማስቀመጥ ዝውውር የለም።' },
  'toast.saveCancelled': {
    en: 'Save cancelled \u2014 review the flagged rows first.',
    am: 'ማስቀመጥ ተሰርዟል \u2014 በመጀመሪያ ምልክት የተደረገባቸውን ረድፎች ይመልከቱ።',
  },
  'toast.savedNoImages': {
    en: 'Saved without receipt images (storage limit)',
    am: 'ያለ ደረሰኝ ምስሎች ተቀምጧል (የማከማቻ ገደብ)',
  },
  'toast.saved': { en: 'Saved {n} transfers for {date}!', am: '{date} ለሆነው {n} ዝውውሮች ተቀምጠዋል!' },
  'toast.saveFailed': { en: 'Failed to save day to localStorage.', am: 'ቀኑን ማስቀመጥ አልቻልንም።' },
  'toast.nothingToExport': { en: 'No transfers to export.', am: 'ለመላክ ዝውውር የለም።' },
  'toast.exported': { en: 'Exported CSV for {date}', am: 'የ{date} CSV ተልኳል' },
  'toast.deleted': { en: 'Transfer deleted.', am: 'ዝውውሩ ተጠፍቷል።' },
  'toast.updated': { en: 'Transfer details updated.', am: 'የዝውውር ዝርዝር ተሻሽሏል።' },
  'toast.clearConfirm': {
    en: 'Clear all transfers from the current screen?',
    am: 'አሁን ካለው ገጽ ሁሉንም ዝውውሮች ማጥፋት?',
  },
  'toast.cleared': { en: 'Cleared current batch.', am: 'የአሁኑ ስብስብ ጸድቷል።' },
  'toast.loaded': { en: 'Loaded {date} with {n} transfers.', am: '{date} ከ{n} ዝውውሮች ጋር ተጭኗል።' },
  'toast.deleteDayConfirm': {
    en: 'Delete saved record for {id}?',
    am: 'የ{id} የተቀመጠ መዝገብ ይጥፋ?',
  },
  'toast.dayDeleted': { en: 'Deleted {id}', am: '{id} ተጠፍቷል' },
  'toast.readFailed': {
    en: 'Could not read {name}: {reason} Added it for manual entry.',
    am: '{name} ማንበብ አልቻልንም፦ {reason} በእጅ ለማስገባት ተጨምሯል።',
  },

  /* Progress / status messages */
  'status.resizing': {
    en: 'Resizing & preparing receipt {i} of {n}\u2026',
    am: 'ደረሰኝ {i} ከ{n} በማዘጋጀት ላይ\u2026',
  },
  'status.reading': {
    en: 'Reading receipt {i} of {n} on-device\u2026',
    am: 'ደረሰኝ {i} ከ{n} በመሣሪያው ላይ በማንበብ ላይ\u2026',
  },
  'status.readingPct': {
    en: 'Reading receipt {i} of {n} on-device\u2026 {p}%',
    am: 'ደረሰኝ {i} ከ{n} በመሣሪያው ላይ በማንበብ ላይ\u2026 {p}%',
  },
  'status.ocrUnavailable': {
    en: 'On-device reading is unavailable (it needs internet the first time).',
    am: 'በመሣሪያው ላይ ማንበብ አይቻልም (በመጀመሪያ ጊዜ ኢንተርኔት ይፈልጋል)።',
  },
  'status.scanningAi': {
    en: 'Scanning receipt {i} of {n} with AI\u2026',
    am: 'ደረሰኝ {i} ከ{n} በAI በመስካን ላይ\u2026',
  },
  'status.retrying': {
    en: 'Extraction service busy. Retrying in {s}s (attempt {a} of {b})\u2026',
    am: 'አገልግሎቱ ሥራ ላይ ነው። በ{s} ሰከንድ ውስጥ ይደገማል ({a} ከ{b})\u2026',
  },
  'err.network': {
    en: 'Network error while contacting the extraction service.',
    am: 'ከአገልግሎቱ ጋር ሲገናኝ የኔትወርክ ስህተት ተፈጥሯል።',
  },

  /* Save-day review dialog */
  'review.header': { en: 'Day review for {date}:', am: 'የ{date} ግምገማ፦' },
  'review.counts': {
    en: '- {n} transfers will count (ETB {total})',
    am: '- {n} ዝውውሮች ይቆጠራሉ (ብር {total})',
  },
  'review.ask': { en: 'Save the day with these rows?', am: 'ቀኑን ከእነዚህ ረድፎች ጋር ያስቀምጡ?' },
  'review.duplicates': { en: '{n} duplicate(s) excluded', am: '{n} ድግግሞሽ(ዎች) ተገልለዋል' },
  'review.nonReceipt': { en: '{n} non-receipt(s) excluded', am: '{n} ደረሰኝ-ያልሆኑ ተገልለዋል' },
  'review.missingRef': {
    en: '{n} missing-reference row(s) excluded',
    am: '{n} ማጣቀሻ-የሌላቸው ረድፎች ተገልለዋል',
  },
  'review.lowConfidence': {
    en: '{n} low-confidence row(s) counted',
    am: '{n} ዝቅተኛ-እርግጠኝነት ረድፎች ተቆጥረዋል',
  },
};

/**
 * Looks up a key and replaces `{placeholder}` tokens with the supplied values.
 * Falls back to the key itself so a missing translation is visible, not empty.
 */
export function translate(
  language: Language,
  key: string,
  vars?: Record<string, string | number>
): string {
  const entry = DICT[key];
  let text = entry ? entry[language] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** Reads the saved language, defaulting from the browser when nothing is stored. */
export function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (raw === 'en' || raw === 'am') return raw;
  return navigator.language?.toLowerCase().startsWith('am') ? 'am' : 'en';
}
