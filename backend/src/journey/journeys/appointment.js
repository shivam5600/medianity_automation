// Appointment journey: department -> doctor -> slot -> atomic hold -> "pending, front desk
// confirming". The patient's name was captured up front (root flow) and is reused here, so we never
// re-ask it. Falls back to a Front-Desk lead when a doctor has no open slots. If the chosen slot is
// taken between selection and hold (concurrency), we re-offer the remaining slots.

import { resolveChoice, advance } from '../helpers.js';
import { createAppointmentCase } from '../../services/cases.js';
import { holdSlot, SlotUnavailableError } from '../../services/booking.js';

const appointment = {
  firstStep: 'department',
  steps: {
    department: {
      prompt(ctx) {
        const options = ctx.store.listDepartments().map((dept, i) => ({
          id: `dept_${i}`,
          title: dept,
          dept,
        }));
        ctx.session.state._choices = options;
        ctx.say('appt_choose_dept', { list: options });
      },
      handle(ctx) {
        const opt = resolveChoice(ctx.inbound, ctx.session.state._choices);
        if (!opt) {
          ctx.say('invalid_input');
          return appointment.steps.department.prompt(ctx);
        }
        ctx.session.state.department = opt.dept;
        advance(ctx, 'doctor');
      },
    },

    doctor: {
      prompt(ctx) {
        const options = ctx.store.listDoctorsByDept(ctx.session.state.department).map((d) => ({
          id: `doc_${d.id}`,
          title: d.name,
          doctorId: d.id,
        }));
        ctx.session.state._choices = options;
        ctx.say('appt_choose_doctor', { list: options });
      },
      handle(ctx) {
        const opt = resolveChoice(ctx.inbound, ctx.session.state._choices);
        if (!opt) {
          ctx.say('invalid_input');
          return appointment.steps.doctor.prompt(ctx);
        }
        ctx.session.state.doctorId = opt.doctorId;
        advance(ctx, 'slot');
      },
    },

    slot: {
      prompt(ctx) {
        const slots = ctx.store.listOpenSlots(ctx.session.state.doctorId);
        if (slots.length === 0) {
          // No availability -> capture as a Front-Desk lead instead of dead-ending.
          const doctor = ctx.store.getDoctor(ctx.session.state.doctorId);
          const patient = ctx.store.upsertPatient({ waPhone: ctx.session.waPhone, lang: ctx.session.lang });
          createAppointmentCase(ctx.store, { patient, doctor });
          ctx.say('appt_no_slots');
          return ctx.endSession();
        }
        const options = slots.map((sl) => ({ id: `slot_${sl.id}`, title: sl.label, slotId: sl.id }));
        ctx.session.state._choices = options;
        ctx.say('appt_choose_slot', { list: options });
      },
      handle(ctx) {
        const opt = resolveChoice(ctx.inbound, ctx.session.state._choices);
        if (!opt) {
          ctx.say('invalid_input');
          return appointment.steps.slot.prompt(ctx);
        }
        ctx.session.state.slotId = opt.slotId;
        finishBooking(ctx);
      },
    },
  },
};

function finishBooking(ctx) {
  const s = ctx.session;
  const doctor = ctx.store.getDoctor(s.state.doctorId);
  const slot = ctx.store.getSlot(s.state.slotId);
  const patient = ctx.store.upsertPatient({ waPhone: s.waPhone, lang: s.lang }); // name already captured

  let booking;
  try {
    booking = holdSlot(ctx.store, { slotId: slot.id, patient, now: ctx.now });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      // Taken during the flow — re-offer whatever remains (or fall back to a lead if none).
      return advance(ctx, 'slot');
    }
    throw err;
  }

  const c = createAppointmentCase(ctx.store, { patient, doctor });
  ctx.store.updateBooking(booking.id, { caseId: c.id });
  ctx.store.updateCase(c.id, { bookingId: booking.id });
  ctx.say('appt_booking_pending', { vars: { no: c.humanNo, doctor: doctor.name, slot: slot.label } });
  ctx.endSession();
}

export default appointment;
