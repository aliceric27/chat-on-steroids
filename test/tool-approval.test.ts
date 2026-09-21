/**
 * Reading ChatGPT's own tool-approval card.
 *
 * ChatGPT asks "Allow ChatGPT to use <app>?" before each connector call, and the content
 * script answers that card for this app's own connectors. Everything that can go wrong with
 * it goes wrong here, in the one function that decides which button means yes — and the
 * expensive failure is not "the automation stopped", it is "the automation pressed Deny".
 *
 * So the case that matters most below is the renderer change nobody controls: ChatGPT
 * emphasising Deny instead of Allow. An implementation that trusts `btn-primary` to mean
 * "the affirmative one" refuses the call with full confidence, and the user sees a tool that
 * silently declines its own work. Every negative case here is the same rule from a different
 * side: when the button cannot be named exactly, nothing is clicked and the user clicks.
 *
 * This runs the shipped extension/chatgpt-dom.js against markup shaped like the live
 * 2026-09-21 card. Nothing is reimplemented.
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../extension/chatgpt-dom.js', import.meta.url), 'utf8');

interface ApprovalRequest {
  card: Element;
  app: string;
  allow: HTMLButtonElement;
}
interface DomApi {
  toolApprovals(): ApprovalRequest[];
  hasApprovalCard(node: unknown): boolean;
}

let dom: JSDOM;
let document: Document;
let api: DomApi;

beforeEach(() => {
  dom = new JSDOM('<body></body>', { url: 'https://chatgpt.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  document = dom.window.document;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', {
    value() { return this.hidden ? [] : [{ width: 10, height: 10 }]; }
  });
  dom.window.eval(source);
  api = (dom.window as unknown as { CLF_DOM: DomApi }).CLF_DOM;
});
afterEach(() => { dom.window.close(); });

/** One button in the card's action row. `id` is only how these assertions name it. */
function action(id: string, className: string, label: string, haspopup = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = id;
  button.className = className;
  button.type = 'button';
  // The live card wraps its label in a div and a span; read through both.
  const inner = document.createElement('span');
  inner.textContent = label;
  button.append(inner);
  if (haspopup) button.setAttribute('aria-haspopup', 'menu');
  return button;
}

/** An approval card, appended to the page. `app` is the quiet line above the question. */
function card(app: string | null, ...buttons: HTMLButtonElement[]): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-testid', 'tool-approval-card');
  if (app !== null) {
    const line = document.createElement('div');
    line.className = 'text-token-text-tertiary text-base tracking-wide';
    line.textContent = app;
    root.append(line);
  }
  const question = document.createElement('h2');
  question.textContent = `Allow ChatGPT to use ${app ?? 'something'}?`;
  const actions = document.createElement('div');
  actions.setAttribute('data-testid', 'tool-action-buttons');
  actions.append(...buttons);
  root.append(question, actions);
  document.body.append(root);
  return root;
}

const ids = () => api.toolApprovals().map(request => request.allow.id);

describe('the Allow button on a tool-approval card', () => {
  it('is pressed on the live card, and reports which app asked', () => {
    card('Chat On Steroids Core',
      action('deny', 'btn btn-secondary', '拒絕'),
      action('allow', 'btn btn-primary', '允許'),
      action('menu', 'btn btn-primary', '允許', true));

    const requests = api.toolApprovals();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.allow.id).toBe('allow');
    expect(requests[0]?.app).toBe('Chat On Steroids Core');
  });

  it('still finds Allow when ChatGPT emphasises Deny instead', () => {
    // The regression this file exists for. Choosing the row's only primary button would
    // press 拒絕 here and refuse the call the user is waiting on.
    card('Chat On Steroids Core',
      action('deny', 'btn btn-primary', '拒絕'),
      action('allow', 'btn btn-secondary', '允許'));

    expect(ids()).toEqual(['allow']);
  });

  it('reads the label through a renamed design system', () => {
    card('Chat On Steroids Desktop',
      action('deny', 'btn xx-secondary', 'Deny'),
      action('allow', 'btn xx-primary', 'Allow'));

    expect(ids()).toEqual(['allow']);
  });

  it('lets emphasis break a tie between two affirmative labels, and only that tie', () => {
    card('TobisComputer',
      action('deny', 'btn btn-secondary', '拒絕'),
      action('once', 'btn btn-secondary', 'Allow once'),
      action('allow', 'btn btn-primary', '允許'));

    expect(ids()).toEqual(['allow']);
  });

  it('never reaches a button outside the action row', () => {
    // The card's description carries its own "查看詳情" button. Pressing that answers nothing
    // and leaves the call waiting behind an opened detail panel.
    const root = card('Chat On Steroids Core',
      action('deny', 'btn btn-secondary', '拒絕'),
      action('allow', 'btn btn-primary', '允許'));
    const description = document.createElement('p');
    description.append(action('details', 'underline', '允許'));
    root.prepend(description);

    expect(ids()).toEqual(['allow']);
  });

  it('ignores the split control half that opens a menu', () => {
    card('Chat On Steroids Core',
      action('deny', 'btn btn-secondary', '拒絕'),
      action('menu', 'btn btn-primary', '允許', true));

    expect(ids()).toEqual([]);
  });

  it('answers nothing when no label can be named', () => {
    card('Chat On Steroids Core',
      action('deny', 'btn', 'Nope'),
      action('allow', 'btn', 'Yep'));

    expect(ids()).toEqual([]);
  });

  it('answers nothing while the Allow button is still mounting disabled', () => {
    const allow = action('allow', 'btn btn-primary', '允許');
    allow.disabled = true;
    card('Chat On Steroids Core', action('deny', 'btn btn-secondary', '拒絕'), allow);

    expect(ids()).toEqual([]);
  });

  it('ignores a hidden card', () => {
    const root = card('Chat On Steroids Core',
      action('deny', 'btn btn-secondary', '拒絕'),
      action('allow', 'btn btn-primary', '允許'));
    root.hidden = true;

    expect(ids()).toEqual([]);
  });

  it("ignores a card drawn inside this app's own surface", () => {
    const root = card('Chat On Steroids Core',
      action('deny', 'btn btn-secondary', '拒絕'),
      action('allow', 'btn btn-primary', '允許'));
    const ours = document.createElement('div');
    ours.className = 'clf-stream';
    document.body.append(ours);
    ours.append(root);

    expect(ids()).toEqual([]);
  });

  it('reports a card that arrived inside an inserted subtree', () => {
    const root = card('Chat On Steroids Core',
      action('deny', 'btn btn-secondary', '拒絕'),
      action('allow', 'btn btn-primary', '允許'));
    const inserted = document.createElement('div');
    inserted.append(root);

    expect(api.hasApprovalCard(inserted)).toBe(true);
    expect(api.hasApprovalCard(root)).toBe(true);
    expect(api.hasApprovalCard(document.createElement('div'))).toBe(false);
    expect(api.hasApprovalCard(null)).toBe(false);
  });
});
