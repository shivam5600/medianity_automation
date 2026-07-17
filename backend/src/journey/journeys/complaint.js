// Complaint journey: category -> room/bed -> describe -> optional photo -> routed ticket + ETA.
// Each step is { prompt(ctx), handle(ctx) } (async). prompt() emits a question; handle() consumes the
// reply and advances. Splitting them lets the engine re-emit any step's prompt on "resume".

import { resolveChoice, advance } from '../helpers.js';
import { createComplaintCase } from '../../services/cases.js';

const complaint = {
  firstStep: 'category',
  steps: {
    category: {
      async prompt(ctx) {
        const lang = ctx.session.lang;
        const cats = await ctx.store.listComplaintCategories();
        const options = cats.map((c) => ({ id: `cat_${c.id}`, title: lang === 'hi' ? c.hi : c.en, categoryId: c.id }));
        ctx.session.state._choices = options;
        ctx.say('complaint_choose_category', { list: options });
      },
      async handle(ctx) {
        const opt = resolveChoice(ctx.inbound, ctx.session.state._choices);
        if (!opt) {
          ctx.say('invalid_input');
          return complaint.steps.category.prompt(ctx);
        }
        ctx.session.state.categoryId = opt.categoryId;
        await advance(ctx, 'room');
      },
    },

    room: {
      async prompt(ctx) {
        ctx.session.state._choices = null;
        ctx.say('complaint_ask_room');
      },
      async handle(ctx) {
        const text = (ctx.inbound.text || '').trim();
        if (!text) {
          ctx.say('invalid_input');
          return complaint.steps.room.prompt(ctx);
        }
        ctx.session.state.roomBed = text;
        await advance(ctx, 'desc');
      },
    },

    desc: {
      async prompt(ctx) {
        ctx.say('complaint_ask_desc');
      },
      async handle(ctx) {
        const text = (ctx.inbound.text || '').trim();
        if (!text) {
          ctx.say('invalid_input');
          return complaint.steps.desc.prompt(ctx);
        }
        ctx.session.state.description = text;
        await advance(ctx, 'photo');
      },
    },

    photo: {
      async prompt(ctx) {
        ctx.say('complaint_ask_photo');
      },
      async handle(ctx) {
        const isImage = ctx.inbound.kind === 'image';
        const skipped = (ctx.inbound.text || '').trim().toLowerCase() === 'skip';
        if (!isImage && !skipped) {
          ctx.say('invalid_input');
          return complaint.steps.photo.prompt(ctx);
        }
        await finishComplaint(ctx, isImage ? ctx.inbound.media : null);
      },
    },
  },
};

async function finishComplaint(ctx, media) {
  const s = ctx.session;
  const patient = await ctx.store.upsertPatient({ waPhone: s.waPhone, lang: s.lang });
  const { case: c, team, etaMin } = await createComplaintCase(ctx.store, {
    patient,
    categoryId: s.state.categoryId,
    roomBed: s.state.roomBed,
    description: s.state.description,
  });
  if (media) {
    // Download the WhatsApp image once and store it as a data URL so it is viewable in the panel
    // (and survives WhatsApp's media-URL expiry). For higher volume, swap to object storage.
    let url = media.url || null;
    try {
      if (media.id && ctx.adapter && typeof ctx.adapter.downloadMedia === 'function') {
        const { buffer, mimeType } = await ctx.adapter.downloadMedia(media.id);
        url = `data:${mimeType};base64,${buffer.toString('base64')}`;
      }
    } catch (e) {
      /* keep the waMediaId; the image can be fetched later */
    }
    await ctx.store.addAttachment(c.id, { url, waMediaId: media.id, kind: 'image' });
  }
  ctx.say('complaint_created', { vars: { no: c.humanNo, team: team.name, eta: etaMin } });
  ctx.endSession();
}

export default complaint;
