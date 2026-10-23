// Vercel serverless function: Formspree webhook  ->  FranServe leads API
// Public URL: https://<your-domain>/api/franserve-lead?key=<WEBHOOK_SECRET>
// Env vars: FRANSERVE_API_KEY, FRANSERVE_BROKER_EMAIL, FRANSERVE_BROKER_ID,
//           WEBHOOK_SECRET, DEFAULT_LEAD_STATE (XX, confirmed accepted by FranServe)

const STATE_CODES = {
  alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",colorado:"CO",
  connecticut:"CT",delaware:"DE","district of columbia":"DC",dc:"DC",florida:"FL",
  georgia:"GA",hawaii:"HI",idaho:"ID",illinois:"IL",indiana:"IN",iowa:"IA",kansas:"KS",
  kentucky:"KY",louisiana:"LA",maine:"ME",maryland:"MD",massachusetts:"MA",michigan:"MI",
  minnesota:"MN",mississippi:"MS",missouri:"MO",montana:"MT",nebraska:"NE",nevada:"NV",
  "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
  "north carolina":"NC","north dakota":"ND",ohio:"OH",oklahoma:"OK",oregon:"OR",
  pennsylvania:"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",
  tennessee:"TN",texas:"TX",utah:"UT",vermont:"VT",virginia:"VA",washington:"WA",
  "west virginia":"WV",wisconsin:"WI",wyoming:"WY",
  alberta:"AB","british columbia":"BC",manitoba:"MB","new brunswick":"NB",
  "newfoundland and labrador":"NL","nova scotia":"NS",ontario:"ON",
  "prince edward island":"PE",quebec:"QC",saskatchewan:"SK"
};
const VALID_CODES = new Set(Object.values(STATE_CODES));

function field(body, name) {
  if (body == null) return "";
  if (body[name] != null) return String(body[name]).trim();
  if (body.data && body.data[name] != null) return String(body.data[name]).trim();
  if (body.submission && body.submission[name] != null) return String(body.submission[name]).trim();
  return "";
}

function buildStateZip(regionRaw, postalRaw) {
  const region = (regionRaw || "").trim();
  const key = region.toLowerCase();
  let state = "";
  if (VALID_CODES.has(region.toUpperCase())) state = region.toUpperCase();
  else if (STATE_CODES[key]) state = STATE_CODES[key];
  const derived = !!state;
  if (!state) state = (process.env.DEFAULT_LEAD_STATE || "XX").toUpperCase();
  let zip = (postalRaw || "").replace(/[^A-Za-z0-9]/g, "");
  if (!zip) zip = "00000";
  return { state, zip, derived };
}

function buildPhone(ccode, phone) {
  const combined = `${ccode || ""} ${phone || ""}`.trim();
  return combined.replace(/[^0-9+()\-\s]/g, "").trim();
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (process.env.WEBHOOK_SECRET && req.query.key !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});

  const first  = field(body, "First name");
  const last   = field(body, "Last name");
  const email  = field(body, "email");
  const phone  = buildPhone(field(body, "Country code"), field(body, "Phone"));
  const city   = field(body, "City / District");
  const region = field(body, "Province / State");
  const postal = field(body, "Postal code");
  const citiz  = field(body, "Country of citizenship");
  const invest = field(body, "Investment level");
  const industry = field(body, "Preferred industry");
  const timeframe = field(body, "Preferred time frame");
  const sms    = field(body, "SMS consent");

  if (!first && !email) {
    console.error("Payload missing expected fields", { keys: Object.keys(body) });
  }

  const { state, zip, derived } = buildStateZip(region, postal);

  const comment = [
    "E-2 Franchise landing page lead.",
    citiz ? `Citizenship: ${citiz}.` : "",
    `Location as entered: ${[city, region, postal].filter(Boolean).join(", ") || "n/a"}.`,
    derived ? "" : "State/zip could not be derived from an international address; using fallback.",
    sms ? `SMS consent: ${sms}.` : ""
  ].filter(Boolean).join(" ");

  const params = {
    brokerEmail: process.env.FRANSERVE_BROKER_EMAIL || "",
    brokerId: process.env.FRANSERVE_BROKER_ID || "",
    leadFirstName: first,
    leadLastName: last,
    leadEmail: email,
    leadPhone: phone,
    leadState: state,
    leadZip: zip,
    leadCity: city,
    leadProvince: region,
    leadPostalCode: postal,
    leadComment: comment,
    leadInitFranchise: industry,
    leadTimeFrame: timeframe,
    leadLiquidCapital: invest
  };
  Object.keys(params).forEach(k => { if (params[k] === "" || params[k] == null) delete params[k]; });

  try {
    const fsRes = await fetch("https://franservesupport.com/api/leads/", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.FRANSERVE_API_KEY || "",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(params).toString()
    });
    const text = await fsRes.text();
    if (fsRes.status === 201) {
      console.log("FranServe lead created", { email, state });
      return res.status(200).json({ ok: true, franserve: text });
    }
    console.error("FranServe rejected lead", { status: fsRes.status, body: text, email, state, zip });
    return res.status(200).json({ ok: false, status: fsRes.status, franserve: text });
  } catch (err) {
    console.error("FranServe request failed", err);
    return res.status(502).json({ ok: false, error: "Upstream request failed" });
  }
}
