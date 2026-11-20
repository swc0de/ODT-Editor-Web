/**
 * Built-in templates. The same HTML renders the Backstage previews and,
 * parsed with the document schema (data-style attributes pick paragraph
 * styles), becomes the content of a new document. All sample text is original.
 */
import { DOMParser as PMDOMParser } from 'prosemirror-model';
import { schema } from '../../core/schema.js';

const TAB = '<span class="odt-tab">\t</span>';

export const TEMPLATES = [
  { id: 'blank', name: 'template.blank', html: '' },
  {
    id: 'handbook',
    name: 'template.handbook',
    html: `
<p class="tp-header" data-style="Header">Riverside Makers Studio${TAB}Members' edition</p>
<p class="tp-title" data-style="Title">The Shared Studio Handbook</p>
<p class="tp-sub" data-style="Subtitle">How we share a workshop of benches, tools and good habits</p>
<p data-style="Standard">The studio is open to members seven days a week. This handbook explains how the space works, what we expect of each other and how to <b>book equipment</b> so that everyone gets a fair turn. Read it once, keep it handy, and suggest changes at the monthly members' meeting.</p>
<h2 data-style="Heading_20_1" data-level="1">Why share a studio?</h2>
<p data-style="Standard">Few of us could afford a kiln, a laser cutter and a letterpress on our own. Together we can, and we learn more by working side by side than we ever would alone. A shared space only works when people look after it.</p>
<p class="tp-quote" data-style="Quote">Leave every bench a little better than you found it.</p>
<h3 data-style="Heading_20_2" data-level="2">House rules</h3>
<ul>
<li><p data-style="List_20_Paragraph"><b>Tidy as you go:</b> clear your bench and sweep up before you leave.</p></li>
<li><p data-style="List_20_Paragraph"><b>Label your work:</b> unlabelled projects go to the shelf by the door after a week.</p></li>
<li><p data-style="List_20_Paragraph"><b>Ask before you borrow:</b> personal tools stay personal unless offered.</p></li>
<li><p data-style="List_20_Paragraph"><b>Quiet hours:</b> no machines before 9 a.m. or after 9 p.m.</p></li>
</ul>
<h3 data-style="Heading_20_2" data-level="2">Bookable equipment</h3>
<p data-style="Standard">Book these on the board by the kitchen. Each slot is two hours, and you need an induction first.</p>
<table><thead><tr><th><p data-style="Table_20_Heading">Equipment</p></th><th><p data-style="Table_20_Heading">Room</p></th><th><p data-style="Table_20_Heading">Inductor</p></th><th><p data-style="Table_20_Heading">Booking</p></th></tr></thead>
<tbody><tr><td><p data-style="Table_20_Contents">Laser cutter</p></td><td><p data-style="Table_20_Contents">Back room</p></td><td><p data-style="Table_20_Contents">Priya S.</p></td><td><p data-style="Table_20_Contents">Board</p></td></tr>
<tr><td><p data-style="Table_20_Contents">Kiln</p></td><td><p data-style="Table_20_Contents">Yard</p></td><td><p data-style="Table_20_Contents">Tom W.</p></td><td><p data-style="Table_20_Contents">Board</p></td></tr>
<tr><td><p data-style="Table_20_Contents">Letterpress</p></td><td><p data-style="Table_20_Contents">Print room</p></td><td><p data-style="Table_20_Contents">Ines R.</p></td><td><p data-style="Table_20_Contents">Calendar</p></td></tr>
<tr><td><p data-style="Table_20_Contents">Band saw</p></td><td><p data-style="Table_20_Contents">Wood shop</p></td><td><p data-style="Table_20_Contents">Anyone</p></td><td><p data-style="Table_20_Contents">First come</p></td></tr></tbody></table>
<h3 data-style="Heading_20_2" data-level="2">Opening up</h3>
<ol><li><p data-style="List_20_Paragraph">Switch on the main lights by the door.</p></li><li><p data-style="List_20_Paragraph">Open the skylight vents if it is warm.</p></li><li><p data-style="List_20_Paragraph">Check the first-aid kit is stocked.</p></li><li><p data-style="List_20_Paragraph">Write your name in the day book.</p></li></ol>
<div class="tp-footer" data-preview-only>1</div>`,
  },
  {
    id: 'letter',
    name: 'template.letter',
    html: `
<p class="tp-name" data-style="Title">Your Name</p>
<p class="tp-small" data-style="No_20_Spacing">Street Address · Town, Postcode · 01234 567890 · you@example.org</p>
<p class="tp-gap" data-style="Standard">18 November 2026</p>
<p class="tp-gap tp-tight" data-style="No_20_Spacing">Recipient Name<br>Title, Organisation<br>Street Address<br>Town, Postcode</p>
<p class="tp-gap" data-style="Standard">Dear Recipient,</p>
<p data-style="Standard">Begin with a sentence that says why you are writing. Keep each paragraph short and focused, and close with what you would like to happen next.</p>
<p data-style="Standard">Thank you for your time.</p>
<p data-style="Standard">Yours sincerely,</p>
<p class="tp-gap" data-style="Standard">Your Name</p>`,
  },
  {
    id: 'resume',
    name: 'template.resume',
    html: `
<p class="tp-name" data-style="Title">Sam Okafor</p>
<p class="tp-small" data-style="No_20_Spacing">Furniture designer · sam@example.org · portfolio.example.org</p>
<h3 class="tp-section" data-style="Heading_20_1" data-level="1">Experience</h3>
<p class="tp-row" data-style="Standard"><span>Lead designer, Oak &amp; Ash Workshop</span>${TAB}<span>2022 – present</span></p>
<p class="tp-row" data-style="Standard"><span>Bench joiner, Northgate Interiors</span>${TAB}<span>2018 – 2022</span></p>
<h3 class="tp-section" data-style="Heading_20_1" data-level="1">Education</h3>
<p class="tp-row" data-style="Standard"><span>BA Furniture Design, Coastal School of Art</span>${TAB}<span>2018</span></p>
<h3 class="tp-section" data-style="Heading_20_1" data-level="1">Skills</h3>
<p class="tp-small" data-style="Standard">Hand joinery, CAD, steam bending, finishing, client briefs</p>`,
  },
  {
    id: 'report',
    name: 'template.report',
    home: false,
    html: `
<p class="tp-title" data-style="Title">Community Garden Annual Report</p>
<p class="tp-sub" data-style="Subtitle">Season summary, budget and plans for next year</p>
<h2 data-style="Heading_20_1" data-level="1">Summary</h2>
<p data-style="Standard">This year the garden grew from twelve to twenty raised beds. Volunteers logged more than 600 hours, and the produce stall raised enough to pay for a new water butt and a tool shed roof.</p>
<h2 data-style="Heading_20_1" data-level="1">Highlights</h2>
<ul>
<li><p data-style="List_20_Paragraph">Eight new beds built from reclaimed timber.</p></li>
<li><p data-style="List_20_Paragraph">A weekly after-school club for the primary school.</p></li>
<li><p data-style="List_20_Paragraph">Seed swap in March with 140 visitors.</p></li>
</ul>
<h2 data-style="Heading_20_1" data-level="1">Budget</h2>
<table><thead><tr><th><p data-style="Table_20_Heading">Item</p></th><th><p data-style="Table_20_Heading">Planned</p></th><th><p data-style="Table_20_Heading">Spent</p></th></tr></thead>
<tbody><tr><td><p data-style="Table_20_Contents">Timber and soil</p></td><td><p data-style="Table_20_Contents">£900</p></td><td><p data-style="Table_20_Contents">£820</p></td></tr>
<tr><td><p data-style="Table_20_Contents">Tools</p></td><td><p data-style="Table_20_Contents">£300</p></td><td><p data-style="Table_20_Contents">£345</p></td></tr>
<tr><td><p data-style="Table_20_Contents">Events</p></td><td><p data-style="Table_20_Contents">£150</p></td><td><p data-style="Table_20_Contents">£95</p></td></tr></tbody></table>
<h2 data-style="Heading_20_1" data-level="1">Next year</h2>
<p data-style="Standard">We plan to add a wildlife pond, start a composting rota and open the garden on the first Sunday of every month.</p>`,
  },
  {
    id: 'newsletter',
    name: 'template.newsletter',
    home: false,
    html: `
<p class="tp-header" data-style="Header">Issue 14${TAB}Autumn</p>
<p class="tp-title" data-style="Title">The Lantern Street Gazette</p>
<p class="tp-sub" data-style="Subtitle">News from the neighbourhood</p>
<h2 data-style="Heading_20_1" data-level="1">Street party a great success</h2>
<p data-style="Standard">Over two hundred neighbours came along to September's street party. Thank you to everyone who brought food, lent tables or helped tidy up afterwards. The raffle raised £410 for the playground fund.</p>
<h3 data-style="Heading_20_2" data-level="2">Library opening hours</h3>
<p data-style="Standard">From November the library on Mill Lane opens late on Thursdays, until 8 p.m., with a homework club from 4 p.m.</p>
<h3 data-style="Heading_20_2" data-level="2">Dates for your diary</h3>
<ul>
<li><p data-style="List_20_Paragraph"><b>12 October:</b> bulb planting on the green.</p></li>
<li><p data-style="List_20_Paragraph"><b>31 October:</b> lantern walk, meet at the church gate at 6 p.m.</p></li>
<li><p data-style="List_20_Paragraph"><b>6 December:</b> winter market.</p></li>
</ul>
<p class="tp-quote" data-style="Quote">Got news to share? Drop a note through the door of number 23.</p>`,
  },
  {
    id: 'meeting',
    name: 'template.meeting',
    home: false,
    html: `
<p class="tp-title" data-style="Title">Meeting Notes</p>
<p class="tp-small" data-style="No_20_Spacing"><b>Date:</b> 18 November 2026 · <b>Time:</b> 10:00 · <b>Place:</b> Room 2</p>
<p class="tp-small" data-style="No_20_Spacing"><b>Attendees:</b> Alex, Bea, Chidi, Dana</p>
<h2 data-style="Heading_20_1" data-level="1">Agenda</h2>
<ol><li><p data-style="List_20_Paragraph">Review of last month's actions</p></li><li><p data-style="List_20_Paragraph">Project timeline</p></li><li><p data-style="List_20_Paragraph">Any other business</p></li></ol>
<h2 data-style="Heading_20_1" data-level="1">Notes</h2>
<p data-style="Standard">Write the main points of the discussion here, one short paragraph per agenda item.</p>
<h2 data-style="Heading_20_1" data-level="1">Actions</h2>
<table><thead><tr><th><p data-style="Table_20_Heading">Action</p></th><th><p data-style="Table_20_Heading">Owner</p></th><th><p data-style="Table_20_Heading">Due</p></th></tr></thead>
<tbody><tr><td><p data-style="Table_20_Contents">Send the updated plan</p></td><td><p data-style="Table_20_Contents">Bea</p></td><td><p data-style="Table_20_Contents">25 Nov</p></td></tr>
<tr><td><p data-style="Table_20_Contents">Book the hall</p></td><td><p data-style="Table_20_Contents">Chidi</p></td><td><p data-style="Table_20_Contents">1 Dec</p></td></tr></tbody></table>`,
  },
];

/** The template as a new document body (null for the blank document). */
export function templateDoc(id) {
  const tpl = TEMPLATES.find((x) => x.id === id);
  if (!tpl || !tpl.html) return null;
  const el = document.createElement('div');
  el.innerHTML = tpl.html;
  el.querySelectorAll('[data-preview-only]').forEach((n) => n.remove());
  const doc = PMDOMParser.fromSchema(schema).parse(el);
  // Lists created from HTML use the built-in list styles; headers become plain paragraphs.
  return doc;
}
