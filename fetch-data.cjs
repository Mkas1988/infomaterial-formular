#!/usr/bin/env node
/**
 * Pre-build script: Fetches study programs from Dynamics 365
 * and saves them as static JSON for the frontend.
 *
 * Reads credentials from environment variables:
 *   DYNAMICS_ORG_URL, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET, DYNAMICS_TENANT_ID
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ORG_URL = process.env.DYNAMICS_ORG_URL || 'https://bcw-gruppe.crm4.dynamics.com';
const CLIENT_ID = process.env.DYNAMICS_CLIENT_ID;
const CLIENT_SECRET = process.env.DYNAMICS_CLIENT_SECRET;
const TENANT_ID = process.env.DYNAMICS_TENANT_ID;

const HOCHSCHULBEREICH_MAP = {
  'FOM - WM': 'FOM School of Business & Management',
  'FOM - IT': 'FOM School of IT Management',
  'FOM - WP': 'FOM School of Psychology',
  'FOM - Ing': 'School of Engineering',
  'FOM - GuS': 'School of Health & Social Management',
  'FOM - WR': 'School of Law',
  'FOM - DS': 'School of Dual Studies',
  'FOM-AS': 'Open Business School',
};

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        else resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const tokenUrl = new URL(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: `${ORG_URL}/.default`,
  }).toString();

  const result = await httpsRequest(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  return result.access_token;
}

async function dynamicsGetAll(token, queryPath) {
  const all = [];
  let url = `${ORG_URL}/api/data/v9.2/${queryPath}`;

  while (url) {
    const parsed = new URL(url);
    const result = await httpsRequest(parsed, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        Prefer: 'odata.include-annotations=*,odata.maxpagesize=5000',
      },
    });
    all.push(...(result.value || []));
    url = result['@odata.nextLink'] || null;
  }
  return all;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !TENANT_ID) {
    console.error('Missing Dynamics credentials. Set DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET, DYNAMICS_TENANT_ID');
    process.exit(1);
  }

  console.log('Authenticating with Dynamics 365...');
  const token = await getToken();
  console.log('Token OK');

  const params = new URLSearchParams({
    $select: 'name,productnumber,bcw_hochschulbereich,bcw_produktkuerzel,bcw_produktgruppe,producturl',
    $expand: 'bcw_Abschluss($select=bcw_name),bcw_StandortTabelle($select=bcw_name),bcw_Studienfach($select=bcw_name),bcw_Produktart($select=bcw_name),bcw_Zeitmodell($select=bcw_name)',
    $filter: 'bcw_produktstatus eq 100000000 and bcw_produktgruppe eq 100000003',
    $orderby: 'name asc',
  });

  console.log('Fetching products...');
  const products = await dynamicsGetAll(token, `products?${params}`);
  console.log(`${products.length} products loaded`);

  const mapped = products.map((p) => {
    const hbLabel = p['bcw_hochschulbereich@OData.Community.Display.V1.FormattedValue'] || '';
    const hochschulbereich = HOCHSCHULBEREICH_MAP[hbLabel] || hbLabel;

    const abschluss = p.bcw_Abschluss?.bcw_name || p['_bcw_abschluss_value@OData.Community.Display.V1.FormattedValue'] || '';
    const standort = p.bcw_StandortTabelle?.bcw_name || p['_bcw_standorttabelle_value@OData.Community.Display.V1.FormattedValue'] || '';
    const studienfach = p.bcw_Studienfach?.bcw_name || p['_bcw_studienfach_value@OData.Community.Display.V1.FormattedValue'] || '';
    const produktart = p.bcw_Produktart?.bcw_name || p['_bcw_produktart_value@OData.Community.Display.V1.FormattedValue'] || '';

    let typ;
    if (produktart.toLowerCase().includes('bachelor')) typ = 'Bachelor';
    else if (produktart.toLowerCase().includes('master')) typ = 'Master';
    else {
      const nl = (p.name || '').toLowerCase();
      if (/bachelor|b\.a\.|b\.sc\.|ll\.b\./.test(nl)) typ = 'Bachelor';
      else if (/master|m\.a\.|m\.sc\.|mba|ll\.m\./.test(nl)) typ = 'Master';
      else typ = produktart || 'Sonstige';
    }

    let produktname = p.name || '';
    if (studienfach) produktname = studienfach;
    if (abschluss && studienfach) produktname = `${abschluss} in ${studienfach}`;

    return {
      Produktname: produktname,
      ProduktTypName: typ,
      Hochschulbereich: hochschulbereich,
      StandortName: standort,
      InstanzID: p.productid || '',
      ECTS: '', DauerZahl: '', DauerEinheit: '',
      AbschlussName: abschluss,
      ProduktNummer: p.productnumber || '',
      ProduktKuerzel: p.bcw_produktkuerzel || '',
    };
  }).filter((m) => m.ProduktTypName === 'Bachelor' || m.ProduktTypName === 'Master');

  console.log(`${mapped.length} Bachelor/Master programs ready`);

  const outDir = path.join(__dirname, 'public');
  fs.writeFileSync(path.join(outDir, 'produkte.json'), JSON.stringify({ success: true, data: mapped }));
  console.log('Written to public/produkte.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
