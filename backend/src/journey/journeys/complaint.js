// Complaint journey: category -> room/bed -> describe -> optional photo -> routed ticket + ETA.
// Each step is { prompt(ctx), handle(ctx) }. prompt() emits a question; handle() consumes the reply
// and advances. Splitting them lets the engine re-emit any step's prompt on "resume".

import { resolveChoice, advance } from '../helpers.js';
import { createComplaintCase } from '../../services/cases.js';

const complaint = {
  firstStep: 'category',
  steps: {
    category: {
      prompt(ctx) {
        const lang = ctx.session.lang;
        const options = ctx.store.listComplaintCategories().map((c) => ({
          id: `cat_${c.id}`,
          title: lang === 'hi' ? c.hi : c.en,
          categoryId: c.id,
        }));
        ctx.session.state._choices = options;
        ctx.say('complaint_choose_category', { list: options });
      },
      handle(ctx) {
        const opt = resolveChoice(ctx.inbound, ctx.session.state._choices);
        if (!opt) {
          ctx.say('invalid_input');
          return complaint.steps.category.prompt(ctx);
        }
        ctx.session.state.categoryId = opt.categoryId;
        advance(ctx, 'room');
      },
    },

    room: {
      prompt(ctx) {
        ctx.session.state._choices = null;
        ctx.say('complaint_ask_room');
      },
      handle(ctx) {
        const text = (ctx.inbound.text || '').trim();
        if (!text) {
          ctx.say('invalid_input');
          return complaint.steps.room.prompt(ctx);
        }
        ctx.session.state.roomBed = text;
        advance(ctx, 'desc');
      },
    },

    desc: {
      prompt(ctx) {
        ctx.say('complaint_ask_desc');
      },
      handle(ctx) {
        const text = (ctx.inbound.text || '').trim();
        if (!text) {
          ctx.say('invalid_input');
          return complaint.steps.desc.prompt(ctx);
        }
        ctx.session.state.description = text;
        advance(ctx, 'photo');
      },
    },

    photo: {
      prompt(ctx) {
        ctx.say('complaint_ask_photo');
      },
      handle(ctx) {
        const isImage = ctx.inbound.kind === 'image';
        const skipped = (ctx.inbound.text || '').trim().toLowerCase() === 'skip';
        if (!isImage && !skipped) {
          ctx.say('invalid_input');
          return complaint.steps.photo.prompt(ctx);
        }
        finishComplaint(ctx, isImage ? ctx.inbound.media : null);
      },
    },
  },
};

function finishComplaint(ctx, media) {
  const s = ctx.session;
  const patient = ctx.store.upsertPatient({ waPhone: s.waPhone, lang: s.lang });
  const { case: c, team, etaMin } = createComplaintCase(ctx.store, {
    patient,
    categoryId: s.state.categoryId,
    roomBed: s.state.roomBed,
    description: s.state.description,
  });
  if (media) {
    ctx.store.addAttachment(c.id, { url: media.url || null, waMediaId: media.id, kind: 'image' });
  }
  ctx.say('complaint_created', { vars: { no: c.humanNo, team: team.name, eta: etaMin } });
  ctx.endSession();
}

export default complaint;
