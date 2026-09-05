const E = require('./solar_call_engine.js');
const s = E.createSession();
const d = E.getGuidance(s, {
  repName: 'the rep',
  companyIdentity: 'LightReach / Illinois Shines (Sara campaign)',
  companyIdentityApproved: true,
});
const c = E.getGuidance(s, {
  repName: 'the rep',
  companyIdentity: 'Acme Solar Approved',
  companyIdentityApproved: true,
});
const out = {
  dirtyLine: d.recommendedLine,
  dirtyBad: /LightReach|Illinois|Sara/i.test(d.recommendedLine || ''),
  cleanLine: c.recommendedLine,
  cleanOk: /Acme Solar Approved/.test(c.recommendedLine || ''),
};
console.log(JSON.stringify(out, null, 2));
process.exit(out.dirtyBad || !out.cleanOk ? 1 : 0);
