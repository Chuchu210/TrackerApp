import { TrackerScriptService } from '../src/tracker-script/tracker-script.service';

describe('TrackerScriptService.getLpScriptSnippet', () => {
  const service = new TrackerScriptService({
    get: () => 'https://track.example.com',
  } as never);

  it('stamps campaign, lp id and lp name on the tag', () => {
    const tag = service.getLpScriptSnippet('lp1', 'direct', 'https://track.example.com', {
      noViewContent: true,
      lpId: 'nexoquote-auto-us',
      lpName: 'Nexo Quote Auto US',
    });
    expect(tag).toContain('data-campaign="lp1"');
    expect(tag).toContain('data-lp-id="nexoquote-auto-us"');
    expect(tag).toContain('data-lp-name="Nexo Quote Auto US"');
    expect(tag).toContain('data-no-viewcontent="true"');
  });
});

describe('TrackerScriptService.getScript', () => {
  const service = new TrackerScriptService({
    get: () => 'https://track.example.com',
  } as never);

  it('forwards data-lp-id on the direct visit', () => {
    const js = service.getScript();
    expect(js).toContain('data-lp-id');
    expect(js).toContain('lpId');
    expect(js).toContain('lpName');
  });

  it('queues steps and conversions until the visit returns a cid', () => {
    const js = service.getScript();
    expect(js).toContain('function whenCidReady');
    expect(js).toContain('function flushPending');
    expect(js).toContain('whenCidReady(function ()');
    expect(js).toContain('trackQuizStarted');
    expect(js).not.toContain('credentials: "include"');
  });
});
