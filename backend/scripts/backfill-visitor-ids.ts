/**
 * Recompute visitorId + isNewVisitor from campaign + IP + user agent.
 * Run: npx ts-node scripts/backfill-visitor-ids.ts
 */
import { PrismaClient } from '@prisma/client';
import { fingerprintVisitorId } from '../src/common/utils/visitor-id';

const prisma = new PrismaClient();

async function main() {
  const clicks = await prisma.click.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      campaignId: true,
      ipAddress: true,
      userAgent: true,
    },
  });

  const seenByCampaign = new Map<string, Set<string>>();
  let updated = 0;

  for (const click of clicks) {
    const visitorId = fingerprintVisitorId(
      click.campaignId,
      click.ipAddress,
      click.userAgent,
    );
    const seen = seenByCampaign.get(click.campaignId) || new Set<string>();
    const isNewVisitor = !seen.has(visitorId);
    seen.add(visitorId);
    seenByCampaign.set(click.campaignId, seen);

    await prisma.click.update({
      where: { id: click.id },
      // `visitorIsFingerprint` PART AVEC `visitorId`, toujours. Ce script recalcule une EMPREINTE d'appareil
      // (campagne + IP + user-agent) : par construction, ce qu'il écrit n'est pas un identifiant de navigateur.
      // L'omettre laissait la colonne dire « vrai cookie » sur une chaîne devenue une empreinte partagée — et
      // comme l'effacement croit la colonne avant le préfixe, il élargissait de nouveau à travers l'appareil du
      // voisin : prénom, nom, courriel et texte de consentement d'un tiers détruits, sans retour. C'est le
      // bloquant du tour 15, rouvert par l'autre bout. Qui écrit l'un écrit l'autre.
      data: { visitorId, isNewVisitor, visitorIsFingerprint: true },
    });
    updated++;
  }

  console.log(`Backfilled ${updated} clicks across ${seenByCampaign.size} campaigns`);
  for (const [campaignId, visitors] of seenByCampaign) {
    console.log(`  campaign ${campaignId}: ${visitors.size} unique visitors`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
