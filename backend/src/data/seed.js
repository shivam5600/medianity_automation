// Default configuration data. Teams and categories are DATA, not code — in production these live in
// the DB and are editable from the admin panel (routing + ETAs change without a deploy).

export function defaultSeed() {
  const teams = [
    { id: 'front_desk', name: 'Front Desk' },
    { id: 'housekeeping', name: 'Housekeeping' },
    { id: 'maintenance', name: 'Maintenance' },
    { id: 'nursing', name: 'Nursing' },
    { id: 'food_diet', name: 'Food & Diet' },
    { id: 'billing', name: 'Billing' },
    { id: 'general', name: 'General / Other' },
  ];

  // journeyType: 'complaint' categories show in the complaint menu and carry an ETA + routing team.
  const categories = [
    { id: 'cleanliness', en: 'Cleanliness', hi: 'साफ-सफाई', team: 'housekeeping', etaMin: 30, journeyType: 'complaint' },
    { id: 'food', en: 'Food', hi: 'खाना', team: 'food_diet', etaMin: 20, journeyType: 'complaint' },
    { id: 'ac_electrical', en: 'AC / Electrical', hi: 'एसी / बिजली', team: 'maintenance', etaMin: 120, journeyType: 'complaint' },
    { id: 'bed_furniture', en: 'Bed / Furniture', hi: 'बेड / फर्नीचर', team: 'maintenance', etaMin: 120, journeyType: 'complaint' },
    { id: 'nursing', en: 'Nursing / Medication', hi: 'नर्सिंग / दवा', team: 'nursing', etaMin: 15, journeyType: 'complaint' },
    { id: 'billing', en: 'Billing', hi: 'बिलिंग', team: 'billing', etaMin: 60, journeyType: 'complaint' },
    { id: 'other', en: 'Other', hi: 'अन्य', team: 'general', etaMin: 120, journeyType: 'complaint' },
  ];

  // A slice of Medinity's real departments; the admin panel manages the full list + availability.
  const doctors = [
    { id: 'doc_ortho_1', name: 'Dr. A. Sharma', department: 'Orthopaedics' },
    { id: 'doc_gyn_1', name: 'Dr. R. Verma', department: 'Obstetrics & Gynaecology' },
    { id: 'doc_cardio_1', name: 'Dr. S. Khan', department: 'Cardiology' },
    { id: 'doc_peds_1', name: 'Dr. N. Gupta', department: 'Pediatrics & Neonatology' },
  ];

  // Slots are illustrative; real slots are published by the front desk. Times are ISO strings.
  const slots = [
    { id: 'slot_1', doctorId: 'doc_ortho_1', label: 'Tomorrow 11:00', startAt: '2026-07-18T11:00:00+05:30', capacity: 1, bookedCount: 0, status: 'open' },
    { id: 'slot_2', doctorId: 'doc_ortho_1', label: 'Tomorrow 11:30', startAt: '2026-07-18T11:30:00+05:30', capacity: 1, bookedCount: 0, status: 'open' },
    { id: 'slot_3', doctorId: 'doc_gyn_1', label: 'Tomorrow 12:00', startAt: '2026-07-18T12:00:00+05:30', capacity: 2, bookedCount: 0, status: 'open' },
  ];

  return { teams, categories, doctors, slots };
}

export function departmentsFrom(doctors) {
  return [...new Set(doctors.map((d) => d.department))];
}
