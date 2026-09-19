import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from '../src/common/guards/api-key.guard';
import { LeadsController } from '../src/leads/leads.controller';
import { duplicateIntakeKeys, IntakeKeyGuard, parseIntakeKeys } from '../src/leads/intake-key.guard';

function guard(keys: string | undefined) {
  return new IntakeKeyGuard({ get: () => keys } as never);
}

function call(presented: string | undefined, body: unknown = {}) {
  const request: Record<string, unknown> = {
    headers: presented === undefined ? {} : { 'x-api-key': presented },
    body,
    ip: '198.51.100.9',
  };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as never };
}

describe("la clé de la porte d'entrée", () => {
  it("n'est pas la clé d'admin, et le contrôleur ne les confond pas", () => {
    // LE POINT DE TOUT CE FICHIER. `ADMIN_API_KEY` ouvre la liste des leads, l'export CSV et la suppression. La
    // porte d'entrée, elle, se confie à chaque site partenaire : gardée par la même clé, déposer une ligne
    // exigerait de donner la base entière. Les deux clés doivent rester deux.
    const proto = LeadsController.prototype as unknown as Record<string, unknown>;
    const guards = (Reflect.getMetadata('__guards__', proto.intake as object) ?? []) as unknown[];
    expect(guards).toContain(IntakeKeyGuard);
    expect(guards).not.toContain(ApiKeyGuard);

    // Et l'inverse : les routes d'administration ne s'ouvrent pas avec une clé de partenaire.
    for (const name of ['list', 'exportCsv', 'eraseVisit', 'remove']) {
      const admin = (Reflect.getMetadata('__guards__', proto[name] as object) ?? []) as unknown[];
      expect(admin).toContain(ApiKeyGuard);
      expect(admin).not.toContain(IntakeKeyGuard);
    }
  });

  it('garde TOUTES les routes du contrôleur, celles qui restent à écrire comprises', () => {
    // La liste des routes était écrite à la main : une route ajoutée plus tard sans garde passait ce test sans
    // être nommée. On les énumère donc depuis le contrôleur lui-même — la route d'effacement par visite était
    // partie en revue sans garde, et c'est exactement cet oubli-là qu'aucune liste figée ne rattrape.
    const proto = LeadsController.prototype as unknown as Record<string, unknown>;
    const routes = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && Reflect.hasMetadata('path', proto[name] as object),
    );
    expect(routes).toContain('intake');
    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const name of routes) {
      const guards = (Reflect.getMetadata('__guards__', proto[name] as object) ?? []) as unknown[];
      expect({ route: name, gardée: guards.length > 0 }).toEqual({ route: name, gardée: true });
    }
  });

  it('reste FERMÉE tant que personne ne lui a donné de clé', () => {
    // Un repli silencieux sur la clé d'admin, ou une porte ouverte quand la variable manque, se déploierait sans
    // que rien ne cesse de marcher — donc sans que personne le voie. Variable absente : la porte refuse.
    const { context } = call('une-clé');
    expect(() => guard(undefined).canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard('').canActivate(context)).toThrow(UnauthorizedException);
    // Une entrée sans clé (« monsite.com: ») n'est pas une entrée : sinon une clé vide ouvrirait la porte.
    expect(parseIntakeKeys('monsite.com:')).toEqual([]);
    expect(() => guard('monsite.com:').canActivate(call('').context)).toThrow(UnauthorizedException);
  });

  it("dit à l'OPÉRATEUR que la porte est murée, sans l'apprendre au visiteur", () => {
    // Sans ce journal, un déploiement où la variable manque rend des 401 que le partenaire lit comme « ma clé est
    // mauvaise » : les deux côtés cherchent au mauvais endroit, et le service tourne des jours sans rien stocker.
    const mure = guard(undefined);
    const dit = jest.spyOn(mure['logger'], 'error').mockImplementation(() => undefined);
    expect(() => mure.canActivate(call('une-clé').context)).toThrow(UnauthorizedException);
    expect(dit).toHaveBeenCalledWith(expect.stringContaining('INTAKE_API_KEYS'));

    // …et le visiteur, lui, reçoit le même refus que pour une mauvaise clé : la réponse n'apprend rien sur nous.
    const ouverte = guard('monsite.com:cle-A');
    let mure_msg = '';
    let cle_msg = '';
    try {
      mure.canActivate(call('x').context);
    } catch (e) {
      mure_msg = (e as Error).message;
    }
    try {
      ouverte.canActivate(call('mauvaise').context);
    } catch (e) {
      cle_msg = (e as Error).message;
    }
    expect(mure_msg).toBe(cle_msg);
  });

  it('ouvre pour la bonne clé, et nomme le site DEPUIS la clé', () => {
    const { request, context } = call('cle-de-monsite');
    expect(guard('MonSite.com:cle-de-monsite').canActivate(context)).toBe(true);
    expect(request.intakeSite).toBe('monsite.com');
  });

  it('refuse une clé voisine, et une clé qui est le PRÉFIXE de la bonne', () => {
    // La comparaison est à temps constant sur des tampons de même longueur ; une comparaison naïve par préfixe
    // laisserait « cle » ouvrir « cle-de-monsite ».
    const keys = 'monsite.com:cle-de-monsite';
    expect(() => guard(keys).canActivate(call('cle-de-monsit').context)).toThrow(UnauthorizedException);
    expect(() => guard(keys).canActivate(call('cle').context)).toThrow(UnauthorizedException);
    expect(() => guard(keys).canActivate(call('cle-de-monsite ').context)).toThrow(UnauthorizedException);
    expect(() => guard(keys).canActivate(call(undefined).context)).toThrow(UnauthorizedException);
  });

  it('donne à chaque partenaire SA clé, révocable sans couper les autres', () => {
    // C'est la raison d'être d'une liste plutôt que d'une clé unique : un partenaire dont la clé fuite se retire
    // de la liste, et les autres continuent de déposer leurs leads.
    const deux = 'monsite.com:cle-A,autresite.fr:cle-B';
    const a = call('cle-A');
    const b = call('cle-B');
    expect(guard(deux).canActivate(a.context)).toBe(true);
    expect(a.request.intakeSite).toBe('monsite.com');
    expect(guard(deux).canActivate(b.context)).toBe(true);
    expect(b.request.intakeSite).toBe('autresite.fr');

    const apresRevocation = 'autresite.fr:cle-B';
    expect(() => guard(apresRevocation).canActivate(call('cle-A').context)).toThrow(UnauthorizedException);
    expect(guard(apresRevocation).canActivate(call('cle-B').context)).toBe(true);
  });

  it("n'attribue pas à un partenaire les leads d'un autre, même s'il le demande", () => {
    // Sans ce refus, un partenaire pourrait gonfler — ou salir — les chiffres d'un concurrent, et lui envoyer des
    // personnes qu'il n'a jamais captées. Le `source` du corps n'est donc qu'une déclaration, vérifiée.
    const deux = 'monsite.com:cle-A,autresite.fr:cle-B';
    expect(() => guard(deux).canActivate(call('cle-A', { source: 'autresite.fr' }).context)).toThrow(
      ForbiddenException,
    );

    // Et la même déclaration, écrite autrement, n'est pas une contradiction : « MonSite.com » est « monsite.com ».
    const ok = call('cle-A', { source: ' MonSite.COM ' });
    expect(guard(deux).canActivate(ok.context)).toBe(true);
    expect(ok.request.intakeSite).toBe('monsite.com');
  });

  it("lit une clé qui contient elle-même des deux-points, et ignore l'espace autour", () => {
    // Une clé engendrée en base64 ou en JWT en contient ; couper au DERNIER deux-points, ou sur tous, rendrait
    // cette clé-là inutilisable — et le partenaire recevrait un 401 que rien n'explique.
    expect(parseIntakeKeys(' monsite.com : a:b:c , autresite.fr:d ')).toEqual([
      { site: 'monsite.com', key: 'a:b:c' },
      { site: 'autresite.fr', key: 'd' },
    ]);
    const { request, context } = call('a:b:c');
    expect(guard('monsite.com:a:b:c').canActivate(context)).toBe(true);
    expect(request.intakeSite).toBe('monsite.com');
  });

  it("ne croit JAMAIS le `source` du corps, même si la garde n'a rien nommé", () => {
    // Le contrôleur pourrait se rabattre sur le corps quand `intakeSite` manque — et ce jour-là, déplacer la
    // garde suffirait à rendre la route crédule sans qu'une ligne de test ne change. Il refuse au lieu de croire.
    const leads = { intake: jest.fn().mockResolvedValue({ stored: true }) };
    const controller = new LeadsController(leads as never);
    void controller.intake({ source: 'autresite.fr', phone: '8135550142' } as never, {});
    expect(leads.intake.mock.calls[0][0]).toMatchObject({ source: undefined });
  });

  it('survit à une requête sans corps', () => {
    // La garde lit `body.source` ; sur une requête vide — ou avant que le corps ne soit analysé — un accès direct
    // jetterait un 500 au lieu du 401 ou du feu vert attendu.
    const { request, context } = call('cle-A', undefined);
    expect(guard('monsite.com:cle-A').canActivate(context)).toBe(true);
    expect(request.intakeSite).toBe('monsite.com');
  });
});

describe("ce que le journal doit dire, et ce qu'il ne doit jamais écrire", () => {
  it("dit chaque refus, avec le site visé et l'adresse — jamais la clé présentée", () => {
    // La documentation promet au partenaire : « dis-le nous, on le voit immédiatement dans nos journaux ».
    // C'était faux : seule l'absence de configuration était journalisée. Une clé fausse — donc un martèlement —
    // ne laissait aucune trace : ni site, ni adresse, ni compteur.
    const porte = guard('monsite.com:cle-A');
    const dit = jest.spyOn(porte['logger'], 'warn').mockImplementation(() => undefined);
    expect(() => porte.canActivate(call('mauvaise-cle', { source: 'monsite.com' }).context)).toThrow(
      UnauthorizedException,
    );
    const message = dit.mock.calls[0][0] as string;
    expect(message).toContain('monsite.com');
    expect(message).toContain('198.51.100.9');
    // La clé présentée n'a rien à faire dans un journal : c'est peut-être la vraie clé d'un autre partenaire,
    // tapée au mauvais endroit. PAS MÊME UN MORCEAU : un mutant qui en écrivait quatre caractères passait
    // l'assertion « la clé entière n'y est pas ».
    for (let i = 0; i + 4 <= 'mauvaise-cle'.length; i++) {
      expect(message).not.toContain('mauvaise-cle'.slice(i, i + 4));
    }
  });

  it('crie quand deux sites partagent la même clé', () => {
    // Une faute de copier-coller de l'opérateur, et le DERNIER gagne : tous les leads du premier partenaire sont
    // attribués au second, sans un mot. La boucle sans court-circuit rend ça silencieux par construction.
    expect(duplicateIntakeKeys('a.com:K,b.com:zzz,c.com:K')).toEqual(['a.com + c.com']);
    expect(duplicateIntakeKeys('a.com:K,b.com:L')).toEqual([]);

    const porte = guard('a.com:K,c.com:K');
    const crie = jest.spyOn(porte['logger'], 'error').mockImplementation(() => undefined);
    const { request, context } = call('K');
    porte.canActivate(context);
    expect(crie).toHaveBeenCalledWith(expect.stringContaining('a.com + c.com'));
    // Et le comportement est celui que le message annonce — « le dernier gagne » — pas un autre en silence.
    expect(request.intakeSite).toBe('c.com');
  });
});
