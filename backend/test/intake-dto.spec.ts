// Ce que la porte refuse AVANT d'écrire quoi que ce soit.
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { IntakeLeadDto } from '../src/leads/dto/intake-lead.dto';

function erreurs(corps: Record<string, unknown>): string[] {
  const dto = plainToInstance(IntakeLeadDto, corps);
  return validateSync(dto, { whitelist: true }).map((e) => e.property);
}

describe("ce que le DTO d'entrée refuse", () => {
  it('refuse une date de capture qui n\'est pas une date', () => {
    // `@IsString` laissait passer « hier », et le service retombait silencieusement sur maintenant : le lead de
    // la veille était daté d'aujourd'hui, et la rétention comme les rapports par jour s'en trouvaient faux.
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', capturedAt: 'hier' })).toContain('capturedAt');
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', capturedAt: '2026-09-01T10:00:00Z' })).toEqual([]);
  });

  it('refuse une date de capture dans le FUTUR', () => {
    // Une visite datée de 2099 n'atteint jamais sa date de purge : les données personnelles de cette personne
    // resteraient pour toujours. Une horloge mal réglée chez un partenaire suffit à produire ce lead-là.
    const dans_un_an = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', capturedAt: dans_un_an })).toContain('capturedAt');
    // …mais pas trente secondes d'avance : les horloges des serveurs ne sont pas synchronisées à la seconde, et
    // perdre un vrai lead pour ça serait absurde.
    const dans_trente_secondes = new Date(Date.now() + 30_000).toISOString();
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', capturedAt: dans_trente_secondes })).toEqual([]);
  });

  it('borne les réponses du questionnaire, en nombre et en longueur', () => {
    // Aux BORNES exactes : 50 réponses passent, 51 non ; 200 caractères passent, 201 non.
    const cinquante = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`q${i}`, 'x'.repeat(200)]));
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', answers: cinquante })).toEqual([]);
    const trop = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`q${i}`, 'x']));
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', answers: trop })).toContain('answers');
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', answers: { q1: 'x'.repeat(201) } })).toContain('answers');
  });

  it('refuse une réponse IMBRIQUÉE et un nom de réponse exotique', () => {
    // `String({…})` vaut « [object Object] » : la borne de longueur laissait passer soixante kilo-octets dedans.
    const imbrique = { q1: { gros: 'x'.repeat(60_000) } };
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', answers: imbrique })).toContain('answers');
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', answers: { q1: ['a', 'b'] } })).toContain('answers');
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', answers: { ['x'.repeat(65)]: 'a' } })).toContain('answers');
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', answers: { 'nom avec espace': 'a' } })).toContain('answers');
    // …et les valeurs simples restent permises : texte, nombre, booléen.
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', answers: { q1: 'a', q2: 3, q3: true } })).toEqual([]);
  });

  it('le PIRE corps permis tient sous 100 ko même quand le partenaire échappe l\u2019Unicode', () => {
    // Python (`json.dumps`) et PHP (`json_encode`) écrivent par défaut chaque caractère non ASCII en `\uXXXX` :
    // six octets. À 500 caractères par réponse, un corps conforme recevait un 413. On mesure le pire cas réel.
    const echappe = (o: unknown) => JSON.stringify(o).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const e = (n: number) => 'é'.repeat(n);
    const pire = {
      source: 'x'.repeat(120), externalId: 'x'.repeat(120), firstName: e(120), lastName: e(120),
      email: 'x'.repeat(200), phone: '8'.repeat(40), zip: e(20), state: e(80), consentText: e(2000),
      pageUrl: 'x'.repeat(500), ip: 'x'.repeat(60), userAgent: e(500), capturedAt: '2026-09-17T14:03:11.000Z',
      isTest: false,
      answers: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`q${i}`.padEnd(64, 'x'), e(200)])),
    };
    expect(erreurs(pire)).toEqual([]);
    expect(Buffer.byteLength(echappe(pire), 'utf8')).toBeLessThan(100 * 1024);
  });

  it('refuse un consentement plus long que ce que la base garde', () => {
    // 4 000 annoncés, 2 000 gardés : la fin du seul texte qui doit être VERBATIM disparaissait en silence, et
    // personne ne s'en apercevait avant d'avoir à le produire.
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', consentText: 'x'.repeat(2001) })).toContain(
      'consentText',
    );
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', consentText: 'x'.repeat(2000) })).toEqual([]);
  });

  it("refuse un isTest qui n'est pas un booléen, et les champs trop longs", () => {
    // « yes » accepté comme isTest ferait passer un lead de test pour un vrai — ou l'inverse selon la lecture.
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', isTest: 'yes' })).toContain('isTest');
    // Un externalId sans borne se tronque plus loin à 190 caractères : deux identifiants longs qui ne diffèrent
    // qu'après se confondraient en une seule personne.
    expect(erreurs({ source: 'monsite.com', phone: '8135550142', externalId: 'x'.repeat(121) })).toContain(
      'externalId',
    );
    expect(erreurs({ source: 'monsite.com', phone: '8'.repeat(41) })).toContain('phone');
  });
});
