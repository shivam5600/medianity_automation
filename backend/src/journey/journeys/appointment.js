// Appointment journey: department -> doctor -> slot -> atomic hold -> "pending, front desk
// confirming". The patient's name was captured up front (root flow) and is reused here, so we never
// re-ask it. Falls back to a Front-Desk lead when a doctor has no open slots. If the chosen slot is
// taken between selection and hold (concurrency), we re-offer the remaining slots. (async: store I/O)

import { resolveChoice, advance } from '../helpers.js';
import { createAppointmentCase } from '../../services/cases.js';
import { holdSlot, SlotUnavailableError } from '../../services/booking.js';

const appointment = {
  firstStep: 'department',
  steps: {
    department: {
      async prompt(ctx) {
        const depts = await ctx.store.listDepartments();
        const options = depts.map((dept, i) => ({ id: `dept_${i}`, title: dept, dept }));
        ctx.session.state._choices = options;
        ctx.say('appt_choose_dept', { list: options });
      },
      async handle(ctx) {
        const opt = resolveChoice(ctx.inbound, ctx.session.state._choices);
        if (!opt) {
          ctx.say('invalid_input');
          return appointment.steps.department.prompt(ctx);
        }
        ctx.session.state.department = opt.dept;
        await advance(ctx, 'doctor');
      },
    },

    doctor: {
      async prompt(ctx) {
        const docs = await ctx.store.listDoctorsByDept(ctx.session.state.department);
        const options = docs.map((d) => ({ id: `doc_${d.id}`, title: d.name, doctorId: d.id }));
        ctx.session.state._choices = options;
        ctx.say('appt_choose_doctor', { list: options });
      },
      async handle(ctx) {
        const opt = resolveChoice(ctx.inbound, ctx.session.state._choices);
        if (!opt) {
          ctx.say('invalid_input');
          return appointment.steps.doctor.prompt(ctx);
        }
        ctx.session.state.doctorId = opt.doctorId;
        await advance(ctx, 'slot');
      },
    },

    slot: {
      async prompt(ctx) {
        const slots = await ctx.store.listOpenSlots(ctx.session.state.doctorId);
        if (slots.length === 0) {
          // No availability -> capture as a Front-Desk lead instead of dead-ending.
          const doctor = await ctx.store.getDoctor(ctx.session.state.doctorId);
          const patient = await ctx.store.upsertPatient({ waPhone: ctx.session.waPhone, lang: ctx.session.lang });
          await createAppointmentCase(ctx.store, { patient, doctor });
          ctx.say('appt_no_slots');
          return ctx.endSession();
        }
        const options = slots.map((sl) => ({ id: `slot_${sl.id}`, title: sl.label, slotId: sl.id }));
        ctx.session.state._choices = options;
        ctx.say('appt_choose_slot', { list: options });
      },
      async handle(ctx) {
        const opt = resolveChoice(ctx.inbound, ctx.session.state._choices);
        if (!opt) {
          ctx.say('invalid_input');
          return appointment.steps.slot.prompt(ctx);
        }
        ctx.session.state.slotId = opt.slotId;
        await finishBooking(ctx);
      },
    },
  },
};

async function finishBooking(ctx) {
  const s = ctx.session;
  const doctor = await ctx.store.getDoctor(s.state.doctorId);
  const slot = await ctx.store.getSlot(s.state.slotId);
  const patient = await ctx.store.upsertPatient({ waPhone: s.waPhone, lang: s.lang }); // name already captured

  let booking;
  try {
    booking = await holdSlot(ctx.store, { slotId: slot.id, patient, now: ctx.now });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      // Taken during the flow — re-offer whatever remains (or fall back to a lead if none).
      return advance(ctx, 'slot');
    }
    throw err;
  }

  const c = await createAppointmentCase(ctx.store, { patient, doctor });
  await ctx.store.updateBooking(booking.id, { caseId: c.id });
  await ctx.store.updateCase(c.id, { bookingId: booking.id });
  ctx.say('appt_booking_pending', { vars: { no: c.humanNo, doctor: doctor.name, slot: slot.label } });
  ctx.endSession();
}

export default appointment;
