import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ClicksService } from '../src/clicks/clicks.service';
import { fingerprintVisitorId } from '../src/common/utils/visitor-id';

/**
 * Le drapeau qui dit « cet identifiant de visiteur est une EMPREINTE d'appareil, pas une personne ».
 *
 * Toute la garde qui empêche une demande d'effacement d'emporter la ligne d'un tiers repose dessus
 * (`lead-sql.ts::visitsOfPerson`). Il n'avait aucun test : ni son écriture — le seul moment où l'information
 * existe encore —, ni la migration qui crée sa colonne. Deux mutants passaient toute la suite : écrire `false`
 * en dur, et vider la migration.
 */
describe("le drapeau d'empreinte de visiteur", () => {
  const service = () =>
    new ClicksService(
      { click: { findFirst: jest.fn().mockResolvedValue(null) } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it("est vrai quand le serveur a dû CALCULER l'identifiant, faux quand le navigateur l'a fourni", async () => {
    const resolve = (visitor: Record<string, unknown>) =>
      (service() as unknown as {
        resolveVisitor: (c: string, v: unknown) => Promise<{ visitorId: string; visitorIsFingerprint: boolean }>;
      }).resolveVisitor('camp-1', visitor);

    // Aucun cookie, aucun `tk_vid` : l'identifiant est l'empreinte campagne + IP + user-agent, que deux
    // téléphones sur le même wifi partagent. Ce n'est pas une personne, et l'effacement doit le savoir.
    const computed = await resolve({ ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 iPhone' });
    expect(computed.visitorId).toBe(fingerprintVisitorId('camp-1', '203.0.113.7', 'Mozilla/5.0 iPhone'));
    expect(computed.visitorIsFingerprint).toBe(true);

    // Le navigateur a fourni le sien : c'est un vrai identifiant de navigateur.
    const given = await resolve({ visitorId: 'v_ann', ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 iPhone' });
    expect(given).toMatchObject({ visitorId: 'v_ann', visitorIsFingerprint: false });

    // Et le cas tordu : le client envoie une chaîne qui RESSEMBLE à une empreinte. Le drapeau dit la vérité —
    // c'est lui qui l'a fournie — et c'est la garde du côté CANDIDAT qui protège le voisin, pas ce drapeau-ci.
    const claimed = await resolve({ visitorId: 'fp_wifi', ipAddress: '203.0.113.7', userAgent: 'UA' });
    expect(claimed.visitorIsFingerprint).toBe(false);
  });

  it("est écrit dans la même instruction que l'identifiant qu'il décrit", () => {
    // Trois endroits écrivent `visitor_id` : la création du clic, le script de rattrapage, et la rétention. Un
    // seul écrivait le drapeau, et c'est exactement comme ça que le bloquant du tour 15 est revenu au tour 16 —
    // par le script, qui posait une empreinte en laissant la colonne dire « vrai cookie ». On tient donc la
    // règle par le texte : qui écrit l'un écrit l'autre.
    const writers = [
      'src/clicks/clicks.service.ts',
      'scripts/backfill-visitor-ids.ts',
    ];
    for (const file of writers) {
      const source = readFileSync(join(__dirname, '..', file), 'utf8');
      // Le bloc `data: { … }` LUI-MÊME, pas le fichier : la première version de ce test cherchait le nom
      // n'importe où, et le commentaire qui explique la règle suffisait à le satisfaire. Le banc de mutation
      // l'a montré — on pouvait retirer l'écriture et garder le commentaire, tout restait vert.
      const blocks = source.match(/data:\s*\{[^}]*\}/gs) ?? [];
      const writers_of_visitor = blocks.filter((block) => /\bvisitorId\b/.test(block));
      if (writers_of_visitor.length === 0) continue;
      for (const block of writers_of_visitor) {
        expect(block).toMatch(/\bvisitorIsFingerprint\b/);
      }
    }
  });

  it('a une migration qui laisse « inconnu » possible', () => {
    // Le schéma de test est dérivé de `schema.prisma`, jamais des migrations : une dérive entre les deux serait
    // invisible ici. Or une migration qui poserait la colonne `NOT NULL DEFAULT false` ferait lire « pas une
    // empreinte » sur toutes les lignes `fp_` héritées — c'est-à-dire le bloquant du tour 15, rouvert en silence
    // par un déploiement, sans qu'un seul test bouge.
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const sql = readdirSync(dir)
      .filter((name) => !name.endsWith('.toml'))
      .map((name) => {
        try {
          return readFileSync(join(dir, name, 'migration.sql'), 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n');

    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/visitorIsFingerprint\s+Boolean\?\s+@map\("visitor_is_fingerprint"\)/);

    const added = sql.match(/ADD COLUMN[^;]*"visitor_is_fingerprint"[^;]*/i);
    expect(added).not.toBeNull();
    expect(added![0]).not.toMatch(/NOT NULL/i);
    expect(added![0]).not.toMatch(/DEFAULT/i);
    // Et le rattrapage ne prétend pas savoir pour les lignes déjà pseudonymisées : elles restent NULL.
    expect(sql).toMatch(/visitor_id"\s+NOT LIKE\s+'p:%'/);
  });
});
