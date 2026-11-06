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
  'total.unverified': { en: '{n} not bank-verified', am: '{n} በባንክ ያልተረጋገጡ' },

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
  'upload.verifyHint': {
    en: 'Each screenshot is checked with the bank through links.et, so the amount comes from the bank\u2019s own receipt \u2014 not from the picture.',
    am: 'እያንዳንዱ ስክሪንሾት ከባንኩ ጋር በlinks.et ይረጋገጣል፤ ስለዚህ መጠኑ ከባንኩ ደረሰኝ ይመጣል \u2014 ከምስሉ አይደለም።',
  },

  /* Receipt link fallback (banks whose URL is not on the screenshot) */
  'link.title': { en: 'Verify a receipt link', am: 'የደረሰኝ ሊንክ ያረጋግጡ' },
  'link.placeholder': {
    en: 'https://\u2026 paste the receipt link',
    am: 'https://\u2026 የደረሰኝ ሊንክ ይለጥፉ',
  },
  'link.verify': { en: 'Verify link', am: 'ሊንኩን ያረጋግጡ' },
  'link.hint': {
    en: 'CBE, Awash, Zemen and Dashen cannot be confirmed from a photo alone. Ask the customer to share the receipt link, then paste it here.',
    am: 'CBE፣ አዋሽ፣ ዘመን እና ዳሽን ከፎቶ ብቻ ሊረጋገጡ አይችሉም። ደንበኛው የደረሰኝ ሊንክ እንዲያጋራ ጠይቀው ከዚህ ይለጥፉ።',
  },
  'link.invalid': {
    en: 'Enter a valid http(s) receipt link.',
    am: 'ትክክለኛ የhttp(s) ደረሰኝ ሊንክ ያስገቡ።',
  },
  'link.verified': {
    en: 'The bank confirmed the transfer.',
    am: 'ባንኩ ዝውውሩን አረጋግጧል።',
  },
  'link.failed': {
    en: 'The bank could not confirm this link.',
    am: 'ባንኩ ይህን ሊንክ ማረጋገጥ አልቻለም።',
  },

  /* Bank verification (links.et) */
  'verify.verifiedBadge': { en: '\u2713 Bank verified', am: '\u2713 በባንክ ተረጋግጧል' },
  'verify.unverifiedBadge': { en: '\u26a0\ufe0f Not verified', am: '\u26a0\ufe0f አልተረጋገጠም' },
  'verify.verifiedBy': { en: 'Confirmed by {bank}', am: 'በ{bank} ተረጋግጧል' },
  'verify.amountLabel': { en: 'BANK-CONFIRMED AMOUNT', am: 'በባንክ የተረጋገጠ መጠን' },
  'verify.payerLabel': { en: 'Payer (bank record)', am: 'ከፋይ (የባንክ መዝገብ)' },
  'verify.receiptNo': { en: 'Bank Receipt No', am: 'የባንክ ደረሰኝ ቁጥር' },
  'verify.feeLabel': { en: 'Service Fee', am: 'የአገልግሎት ክፍያ' },
  'verify.totalPaidLabel': { en: 'Total Debited', am: 'ጠቅላላ የተከፈለ' },
  'verify.statusUnverified': { en: 'Not confirmed by bank', am: 'በባንክ አልተረጋገጠም' },
  'verify.reason.unsupported_provider': {
    en: 'This bank\u2019s screenshot cannot be checked. Ask the customer for the receipt link, then verify it.',
    am: 'የዚህ ባንክ ስክሪንሾት ማረጋገጥ አይቻልም። ደንበኛው የደረሰኝ ሊንክ እንዲሰጥ ጠይቀው ያረጋግጡ።',
  },
  'verify.reason.no_reference': {
    en: 'No transaction number was found on this screenshot.',
    am: 'በዚህ ስክሪንሾት ላይ የግብይት ቁጥር አልተገኘም።',
  },
  'verify.reason.provider_needs_full_url': {
    en: 'This bank needs the full receipt link to confirm the payment, not just a screenshot.',
    am: 'ይህ ባንክ ክፍያውን ለማረጋገጥ ሙሉ የደረሰኝ ሊንክ ይፈልጋል፣ ስክሪንሾት ብቻ አይበቃም።',
  },
  'verify.reason.upstream_failed': {
    en: 'The bank did not answer in time. Try the same screenshot again.',
    am: 'ባንኩ በሰዓቱ አልመለሰም። ተመሳሳዩን ስክሪንሾት እንደገና ይሞክሩ።',
  },
  'verify.reason.not_completed': {
    en: 'The bank reports this transfer as failed or cancelled.',
    am: 'ባንኩ ይህ ዝውውር እንዳልተሳካ ወይም እንደተሰረዘ ይናገራል።',
  },
  'verify.reason.amount_not_found': {
    en: 'The bank receipt was found, but no amount could be read from it.',
    am: 'የባንኩ ደረሰኝ ተገኘ፣ ግን መጠን ማንበብ አልተቻለም።',
  },
  'verify.reason.qr_receipt': {
    en: 'This receipt is a QR code, which cannot be verified from a screenshot.',
    am: 'ይህ ደረሰኝ የQR ኮድ ነው፤ ከስክሪንሾት ማረጋገጥ አይቻልም።',
  },
  'verify.reason.unknown': { en: 'Could not be verified by the bank.', am: 'በባንኩ ማረጋገጥ አልተቻለም።' },

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
    en: 'Upload or photograph your customers\u2019 transfer screenshots above. Each one is checked with the bank, duplicates are excluded, and the day\u2019s total is calculated for you.',
    am: 'ከላይ የደንበኞችዎን የዝውውር ስክሪንሾት ይጫኑ ወይም ፎቶ ያንሱ። እያንዳንዱ ከባንኩ ጋር ይረጋገጣል፣ ድግግሞሾች ይገለላሉ፣ የቀኑም ድምር ለእርስዎ ይሰላል።',
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
  'card.verifyByLink': { en: 'Verify by link', am: 'በሊንክ ያረጋግጡ' },
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
  'toast.batchChecked': {
    en: 'Checked {n} screenshot(s): {verified} bank-verified, {unverified} not confirmed.',
    am: '{n} ስክሪንሾቶች ተረጋግጠዋል፦ {verified} በባንክ የተረጋገጡ፣ {unverified} ያልተረጋገጡ።',
  },
  'toast.verified': {
    en: '{n} screenshot(s) confirmed by the bank.',
    am: '{n} ስክሪንሾቶች በባንኩ ተረጋግጠዋል።',
  },
  'toast.verifyFailed': {
    en: 'Could not check {name}: {reason} Added it for manual entry.',
    am: '{name} ማረጋገጥ አልቻልንም፦ {reason} በእጅ ለማስገባት ተጨምሯል።',
  },
  'toast.quotaExceeded': {
    en: 'The links.et screenshot allowance is used up. Receipts verified before still re-check for free.',
    am: 'የlinks.et የስክሪንሾት ገደብ አልቋል። ቀደም ብለው የተረጋገጡ ደረሰኞች አሁንም በነጻ ይመረመራሉ።',
  },
  'toast.keyMissing': {
    en: 'The links.et API key is missing on the server. Add LINKS_ET_API_KEY to .env.local, then try again.',
    am: 'የlinks.et API ቁልፍ በሰርቨሩ ላይ የለም። LINKS_ET_API_KEY ን በ.env.local ውስጥ ያክሉ፣ ቀጥሎ እንደገና ይሞክሩ።',
  },
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

  /* Progress / status messages */
  'status.preparing': {
    en: 'Preparing screenshot {i} of {n}\u2026',
    am: 'ስክሪንሾት {i} ከ{n} በማዘጋጀት ላይ\u2026',
  },
  'status.verifying': {
    en: 'Checking screenshot {i} of {n} with the bank\u2026',
    am: 'ስክሪንሾት {i} ከ{n} ከባንኩ ጋር በማረጋገጥ ላይ\u2026',
  },
  'status.cachedCheck': {
    en: 'Reusing the earlier bank check for screenshot {i} of {n}\u2026',
    am: 'ለስክሪንሾት {i} ከ{n} ቀደም የተደረገው ማረጋገጫ በመጠቀም ላይ\u2026',
  },
  'status.verifyingLink': {
    en: 'Checking the receipt link with the bank\u2026',
    am: 'የደረሰኝ ሊንኩን ከባንኩ ጋር በማረጋገጥ ላይ\u2026',
  },
  'status.retrying': {
    en: 'Verification service busy. Retrying in {s}s (attempt {a} of {b})\u2026',
    am: 'የማረጋገጫ አገልግሎቱ ሥራ ላይ ነው። በ{s} ሰከንድ ውስጥ ይደገማል ({a} ከ{b})\u2026',
  },
  'err.network': {
    en: 'Network error while contacting the verification service.',
    am: 'ከማረጋገጫ አገልግሎቱ ጋር ሲገናኝ የኔትወርክ ስህተት ተፈጥሯል።',
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
  'review.unverified': {
    en: '{n} row(s) the bank did not confirm',
    am: '{n} በባንክ ያልተረጋገጡ ረድፎች',
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
