<script setup>
import SiteNav from '../shared/SiteNav.vue'
import AssessmentRecord from './AssessmentRecord.vue'
// BSCC Star Awards: the printable certificates. The PDFs and their preview images live in
// public/certificates/ and are served as-is at /certificates/...
const certificates = [
  {
    stars: 1,
    title: '1 Star Paddler',
    summary: 'Getting started: carrying the boat safely, getting in and out, paddling forwards and backwards, stopping, turning, moving sideways and support strokes; capsize and swim, rafting up, the rules of the river and dressing for the conditions.',
    pdf: '/certificates/bscc-1-star-award.pdf',
    preview: '/certificates/bscc-1-star-award-preview.png'
  },
  {
    stars: 2,
    title: '2 Star Paddler',
    summary: 'Skills to a high standard, helping a capsized paddler, recognising hazards, care for other river users and the river, naming boat parts and fitting the boat, using different craft, emptying a boat and portaging.',
    pdf: '/certificates/bscc-2-star-award.pdf',
    preview: '/certificates/bscc-2-star-award-preview.png'
  },
  {
    stars: 3,
    title: '3 Star Paddler',
    summary: 'Racing technique: the stroke stages (catch, power, airtime), power from the core and locking the frame, leg drive, an economic technique; race starts, turns and portages, marathon distance and sprinting, and race strategies including wash hanging.',
    pdf: '/certificates/bscc-3-star-award.pdf',
    preview: '/certificates/bscc-3-star-award-preview.png'
  }
]
</script>

<template>
  <SiteNav current="/bscc-stars/" />
  <main class="stars">
    <p class="kicker">Bishops Stortford Canoe Club</p>
    <h1>BSCC Star Awards</h1>
    <p class="intro">
      Certificates to print and present. Each is a single A5 portrait page: write the
      paddler's name and the date, and sign it as coach or assessor.
    </p>

    <AssessmentRecord />

    <h2 class="certs-h">Certificates</h2>
    <section class="certs">
      <article v-for="c in certificates" :key="c.stars" class="cert">
        <a :href="c.pdf" target="_blank" rel="noopener" class="cert__preview" :aria-label="`Open the ${c.title} certificate`">
          <img :src="c.preview" :alt="`${c.title} certificate`" width="641" height="910" loading="lazy" />
        </a>
        <div class="cert__body">
          <h2><span class="cert__stars" aria-hidden="true">{{ '★'.repeat(c.stars) }}</span> {{ c.title }}</h2>
          <p>{{ c.summary }}</p>
          <div class="cert__actions">
            <a :href="c.pdf" :download="c.pdf.split('/').pop()" class="btn">Download PDF</a>
            <a :href="c.pdf" target="_blank" rel="noopener" class="link">Open to print</a>
          </div>
          <p class="cert__meta">A5 portrait · PDF</p>
        </div>
      </article>
    </section>

  </main>
</template>

<style scoped>
.stars {
  max-width: 1040px;
  margin: 0 auto;
  padding: 48px 28px 56px;
}
.kicker {
  margin: 0 0 6px;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--clay);
}
h1 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2.8rem, 8vw, 5rem);
  line-height: 0.95;
  color: var(--teal-deep);
}
.intro {
  max-width: 60ch;
  margin: 16px 0 32px;
  font-size: 1.05rem;
  color: var(--teal);
}
.certs-h { margin: 0 0 14px; font-family: var(--font-display); font-size: 2rem; color: var(--teal-deep); }
.certs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 28px;
}
.cert {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1.5px solid var(--teal);
  border-radius: 6px;
  overflow: hidden;
}
.cert__preview { display: block; background: #f7f3ea; border-bottom: 1.5px solid var(--teal); }
.cert__preview img { display: block; width: 100%; height: auto; }
.cert__preview:hover img, .cert__preview:focus-visible img { opacity: 0.92; }
.cert__body { padding: 18px 20px 20px; display: flex; flex-direction: column; flex: 1; }
.cert__body h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.7rem;
  color: var(--teal-deep);
}
.cert__stars { color: #e3a91c; letter-spacing: 0.05em; }
.cert__body p { margin: 8px 0 0; font-size: 0.95rem; }
.cert__actions { display: flex; align-items: center; gap: 18px; margin-top: auto; padding-top: 16px; }
.btn {
  display: inline-block;
  padding: 0.55em 1.2em;
  border-radius: 999px;
  background: var(--teal-deep);
  color: #fff;
  font-weight: 600;
  text-decoration: none;
}
.btn:hover, .btn:focus-visible { background: var(--clay); }
.link { color: var(--teal-deep); font-weight: 600; text-underline-offset: 3px; }
.link:hover, .link:focus-visible { color: var(--clay); }
.cert__body .cert__meta { margin-top: 10px; font-size: 0.8rem; color: #6b7572; }
@media (max-width: 640px) {
  .stars { padding: 28px 14px 40px; }
  .certs { gap: 18px; }
}
</style>
