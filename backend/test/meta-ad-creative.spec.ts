import {
  parseMetaAdCreative,
  parseMetaAdCreativeBatch,
} from '../src/platform-sync/meta-ad-creative.parse';

describe('parseMetaAdCreative', () => {
  it('reads title, image and CTA from a simple creative', () => {
    const parsed = parseMetaAdCreative('12021', {
      id: '12021',
      name: 'img3_titleB',
      creative: {
        title: 'Découvrez notre offre',
        body: 'Testez gratuitement',
        image_url: 'https://cdn.example/full.jpg',
        thumbnail_url: 'https://cdn.example/thumb.jpg',
        call_to_action_type: 'LEARN_MORE',
      },
    });

    expect(parsed).toMatchObject({
      adId: '12021',
      adName: 'img3_titleB',
      headline: 'Découvrez notre offre',
      body: 'Testez gratuitement',
      cta: 'Learn More',
      imageUrl: 'https://cdn.example/full.jpg',
      thumbnailUrl: 'https://cdn.example/thumb.jpg',
    });
  });

  it('falls back to object_story_spec.link_data', () => {
    const parsed = parseMetaAdCreative('99', {
      name: 'story-ad',
      creative: {
        object_story_spec: {
          link_data: {
            name: 'Headline from story',
            message: 'Body from story',
            picture: 'https://cdn.example/pic.jpg',
            call_to_action: { type: 'SHOP_NOW' },
          },
        },
      },
    });

    expect(parsed.headline).toBe('Headline from story');
    expect(parsed.body).toBe('Body from story');
    expect(parsed.imageUrl).toBe('https://cdn.example/pic.jpg');
    expect(parsed.cta).toBe('Shop Now');
  });

  it('falls back to asset_feed_spec for Advantage+ ads', () => {
    const parsed = parseMetaAdCreative('88', {
      creative: {
        asset_feed_spec: {
          titles: [{ text: 'Feed title' }],
          bodies: [{ text: 'Feed body' }],
          images: [{ url: 'https://cdn.example/feed.jpg' }],
          call_to_action_types: ['SIGN_UP'],
        },
      },
    });

    expect(parsed.headline).toBe('Feed title');
    expect(parsed.body).toBe('Feed body');
    expect(parsed.imageUrl).toBe('https://cdn.example/feed.jpg');
    expect(parsed.cta).toBe('Sign Up');
  });

  it('stores a Graph error instead of pretending the ad exists', () => {
    const parsed = parseMetaAdCreative('404', {
      error: { message: 'Unsupported get request', code: 100 },
    });
    expect(parsed.lastError).toBe('Unsupported get request');
    expect(parsed.headline).toBeUndefined();
  });
});

describe('parseMetaAdCreativeBatch', () => {
  it('parses a Graph ids= map and ignores paging', () => {
    const rows = parseMetaAdCreativeBatch({
      '111': { name: 'A', creative: { title: 'One' } },
      '222': { name: 'B', creative: { title: 'Two' } },
      paging: { next: 'nope' },
    });
    expect(rows.map((r) => r.adId).sort()).toEqual(['111', '222']);
    expect(rows.find((r) => r.adId === '111')?.headline).toBe('One');
  });
});
