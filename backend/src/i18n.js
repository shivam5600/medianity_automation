// Bilingual strings. Each entry is { en, hi }. Values may be functions of `vars`.
// Falls back to English when a Hindi string is missing, and to the raw key if neither exists.

const STRINGS = {
  choose_language: {
    en: 'Welcome to Medinity Hospital. Please choose your language.',
    hi: 'मेडिनिटी हॉस्पिटल में आपका स्वागत है। कृपया अपनी भाषा चुनें।',
  },
  language_set: {
    en: 'Great — we will continue in English.',
    hi: 'ठीक है — हम हिंदी में आगे बढ़ेंगे।',
  },
  menu_prompt: {
    en: 'How can we help you today?',
    hi: 'आज हम आपकी कैसे मदद कर सकते हैं?',
  },
  menu_appointment: { en: 'Appointment / enquiry', hi: 'अपॉइंटमेंट / पूछताछ' },
  menu_complaint: { en: 'Report a problem', hi: 'समस्या दर्ज करें' },
  menu_support: { en: 'Talk to our team', hi: 'हमारी टीम से बात करें' },

  // ---- support handoff (human takeover; two-way admin reply is the next leg) ----
  support_created: {
    en: (v) =>
      `Thanks — we have alerted our support team (ref ${v.no}). You can also call us at ${v.phone}. Our team will reply to you right here. Type "menu" to go back to the options.`,
    hi: (v) =>
      `धन्यवाद — हमने अपनी सहायता टीम को सूचित कर दिया है (संदर्भ ${v.no})। आप हमें ${v.phone} पर कॉल भी कर सकते हैं। हमारी टीम आपको यहीं जवाब देगी। विकल्पों पर लौटने के लिए "menu" लिखें।`,
  },

  // ---- name capture (mobile is captured automatically from WhatsApp) ----
  name_confirm: {
    en: (v) => `We have your name as ${v.name}. Is that correct?`,
    hi: (v) => `हमारे पास आपका नाम ${v.name} है। क्या यह सही है?`,
  },
  name_yes: { en: 'Yes, correct', hi: 'हाँ, सही है' },
  name_no: { en: 'No, change it', hi: 'नहीं, बदलें' },
  name_ask: {
    en: 'Please type your full name (letters only).',
    hi: 'कृपया अपना पूरा नाम लिखें (केवल अक्षर)।',
  },
  name_invalid: {
    en: 'That does not look like a valid name. Please enter your name without any numbers.',
    hi: 'यह एक मान्य नाम नहीं लगता। कृपया बिना किसी अंक के अपना नाम दर्ज करें।',
  },

  // ---- resume / restart ----
  resume_prompt: {
    en: 'You have an unfinished request. Resume where you left off, or start over?',
    hi: 'आपका एक अधूरा अनुरोध है। जहाँ छोड़ा था वहीं से जारी रखें, या नया शुरू करें?',
  },
  resume_continue: { en: 'Resume', hi: 'जारी रखें' },
  resume_restart: { en: 'Start over', hi: 'नया शुरू करें' },
  restarted: {
    en: "Okay, let's start fresh.",
    hi: 'ठीक है, हम नए सिरे से शुरू करते हैं।',
  },
  invalid_input: {
    en: 'Sorry, I did not get that. Please pick one of the options.',
    hi: 'माफ़ करें, समझ नहीं आया। कृपया दिए गए विकल्पों में से चुनें।',
  },

  // ---- complaint journey ----
  complaint_choose_category: {
    en: 'What is the problem about?',
    hi: 'समस्या किस बारे में है?',
  },
  complaint_ask_room: {
    en: 'Which room or bed number is this for? (e.g. 204 / Bed 3)',
    hi: 'यह किस कमरे या बेड नंबर के लिए है? (जैसे 204 / बेड 3)',
  },
  complaint_ask_desc: {
    en: 'Please describe the problem in a few words.',
    hi: 'कृपया समस्या को कुछ शब्दों में बताएँ।',
  },
  complaint_ask_photo: {
    en: 'Send a photo of the problem if you can, or type "skip".',
    hi: 'यदि संभव हो तो समस्या की एक फ़ोटो भेजें, या "skip" लिखें।',
  },
  complaint_created: {
    en: (v) =>
      `Ticket ${v.no} created. ${v.team} has been notified. Estimated time: ${v.eta} min. We will update you here.`,
    hi: (v) =>
      `टिकट ${v.no} बन गया है। ${v.team} को सूचित कर दिया गया है। अनुमानित समय: ${v.eta} मिनट। हम आपको यहीं अपडेट देंगे।`,
  },

  // ---- appointment journey ----
  appt_choose_dept: { en: 'Which department do you need?', hi: 'आपको कौन सा विभाग चाहिए?' },
  appt_choose_doctor: { en: 'Please choose a doctor.', hi: 'कृपया एक डॉक्टर चुनें।' },
  appt_no_slots: {
    en: 'No open slots for this doctor right now. Our front desk will call you to arrange a time.',
    hi: 'अभी इस डॉक्टर के लिए कोई स्लॉट उपलब्ध नहीं है। हमारा फ्रंट डेस्क समय तय करने के लिए आपको कॉल करेगा।',
  },
  appt_choose_slot: { en: 'Please pick a time slot.', hi: 'कृपया एक समय स्लॉट चुनें।' },
  appt_ask_name: { en: 'What name should the appointment be under?', hi: 'अपॉइंटमेंट किस नाम से हो?' },
  appt_booking_pending: {
    en: (v) =>
      `Ticket ${v.no}. We have held ${v.doctor}, ${v.slot}. Status: pending — our front desk will confirm shortly.`,
    hi: (v) =>
      `टिकट ${v.no}। हमने ${v.doctor}, ${v.slot} रोक लिया है। स्थिति: लंबित — हमारा फ्रंट डेस्क जल्द ही पुष्टि करेगा।`,
  },

  // ---- status updates (admin-triggered / scheduled) ----
  status_assigned: {
    en: (v) => `Update on ticket ${v.no}: assigned to our team. ETA ${v.eta} min.`,
    hi: (v) => `टिकट ${v.no} पर अपडेट: हमारी टीम को सौंपा गया। अनुमानित समय ${v.eta} मिनट।`,
  },
  status_on_the_way: {
    en: (v) => `Update on ticket ${v.no}: our staff is on the way.`,
    hi: (v) => `टिकट ${v.no} पर अपडेट: हमारा स्टाफ रास्ते में है।`,
  },
  status_resolved: {
    en: (v) => `Ticket ${v.no} is resolved. How would you rate our service? Reply with a number from 1 to 10.`,
    hi: (v) => `टिकट ${v.no} हल हो गया है। कृपया हमारी सेवा को 1 से 10 के बीच एक अंक भेजकर रेट करें।`,
  },
  booking_confirmed: {
    en: (v) => `Your appointment is confirmed: ${v.doctor}, ${v.slot}. Ticket ${v.no}.`,
    hi: (v) => `आपकी अपॉइंटमेंट पक्की हो गई है: ${v.doctor}, ${v.slot}। टिकट ${v.no}।`,
  },
  appointment_reminder: {
    en: (v) => `Reminder: your appointment ${v.doctor}, ${v.slot} is tomorrow. Reply "restart" to change.`,
    hi: (v) => `याद दिलाना: आपकी अपॉइंटमेंट ${v.doctor}, ${v.slot} कल है। बदलने के लिए "restart" भेजें।`,
  },
  feedback_reminder: {
    en: (v) => `We would love your feedback on ticket ${v.no}. Please reply with a number from 1 to 10.`,
    hi: (v) => `टिकट ${v.no} पर आपकी प्रतिक्रिया हमारे लिए महत्वपूर्ण है। कृपया 1 से 10 के बीच एक अंक भेजें।`,
  },
  feedback_thanks: {
    en: 'Thank you for your feedback!',
    hi: 'आपकी प्रतिक्रिया के लिए धन्यवाद!',
  },
};

export function t(lang, key, vars = {}) {
  const entry = STRINGS[key];
  if (!entry) return key;
  const val = entry[lang] ?? entry.en;
  return typeof val === 'function' ? val(vars) : val;
}

export function hasKey(key) {
  return Boolean(STRINGS[key]);
}
