import { openAiEventForEventType } from '../src/shared/tracking/openai-events';
import { extractOpenAiAttribution } from '../src/shared/tracking/openai-attribution';

describe('openAiEventForEventType', () => {
  it('maps the auto page-load conversion to page_viewed (contents shape)', () => {
    expect(openAiEventForEventType('viewcontent')).toEqual({
      type: 'page_viewed',
      dataType: 'contents',
    });
  });

  it('maps lead to lead_created (customer_action shape)', () => {
    expect(openAiEventForEventType('lead')).toEqual({
      type: 'lead_created',
      dataType: 'customer_action',
    });
  });

  it('maps purchase to order_created (contents shape)', () => {
    expect(openAiEventForEventType('purchase')).toEqual({
      type: 'order_created',
      dataType: 'contents',
    });
  });

  it('is case-insensitive', () => {
    expect(openAiEventForEventType('LEAD').type).toBe('lead_created');
  });

  it('sends funnel steps with no honest standard equivalent as custom events', () => {
    expect(openAiEventForEventType('call_connected')).toEqual({
      type: 'custom',
      dataType: 'custom',
      customEventName: 'call_connected',
    });
  });

  it('falls back to a custom event for unknown slugs', () => {
    const result = openAiEventForEventType('something_new');
    expect(result.type).toBe('custom');
    expect(result.dataType).toBe('custom');
    expect(result.customEventName).toBe('something_new');
  });

  it('sanitizes custom event names to the allowed charset', () => {
    expect(openAiEventForEventType('weird name!').customEventName).toBe(
      'weird_name_',
    );
  });
});

describe('extractOpenAiAttribution', () => {
  it('picks up oppref from the landing page query', () => {
    expect(extractOpenAiAttribution({ oppref: 'abc123' }).oppref).toBe('abc123');
  });

  it('accepts prefixed aliases', () => {
    expect(extractOpenAiAttribution({ openai_oppref: 'xyz' }).oppref).toBe('xyz');
  });

  it('picks up obref forwarded from the __obref cookie', () => {
    expect(extractOpenAiAttribution({ obref: 'browser-ref' }).obref).toBe(
      'browser-ref',
    );
  });

  it('returns nulls when nothing is present', () => {
    expect(extractOpenAiAttribution({ utm_source: 'openai' })).toEqual({
      oppref: null,
      obref: null,
    });
  });

  it('ignores blank values', () => {
    expect(extractOpenAiAttribution({ oppref: '   ' }).oppref).toBeNull();
  });
});
