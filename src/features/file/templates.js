/**
 * Built-in templates, written as page HTML for the Backstage previews (and
 * used as the starting content of new documents once editing exists, M2/M12).
 * All sample content is original.
 */
export const TEMPLATES = [
  { id: 'blank', name: 'template.blank', html: '' },
  {
    id: 'handbook',
    name: 'template.handbook',
    html: `
<div class="tp-header"><span>Riverside Makers Studio</span><span>Members' edition</span></div>
<h1>The Shared Studio Handbook</h1>
<p class="tp-sub">How we share a workshop of benches, tools and good habits</p>
<p>The studio is open to members seven days a week. This handbook explains how the space works, what we expect of each other and how to <b>book equipment</b> so that everyone gets a fair turn. Read it once, keep it handy, and suggest changes at the monthly members' meeting.</p>
<h2>Why share a studio?</h2>
<p>Few of us could afford a kiln, a laser cutter and a letterpress on our own. Together we can, and we learn more by working side by side than we ever would alone. A shared space only works when people look after it.</p>
<p class="tp-quote">Leave every bench a little better than you found it.</p>
<h3>House rules</h3>
<ul>
<li><b>Tidy as you go:</b> clear your bench and sweep up before you leave.</li>
<li><b>Label your work:</b> unlabelled projects go to the shelf by the door after a week.</li>
<li><b>Ask before you borrow:</b> personal tools stay personal unless offered.</li>
<li><b>Quiet hours:</b> no machines before 9 a.m. or after 9 p.m.</li>
</ul>
<h3>Bookable equipment</h3>
<p>Book these on the board by the kitchen. Each slot is two hours, and you need an induction first.</p>
<table><tr><th>Equipment</th><th>Room</th><th>Inductor</th><th>Booking</th></tr>
<tr><td>Laser cutter</td><td>Back room</td><td>Priya S.</td><td>Board</td></tr>
<tr><td>Kiln</td><td>Yard</td><td>Tom W.</td><td>Board</td></tr>
<tr><td>Letterpress</td><td>Print room</td><td>Ines R.</td><td>Calendar</td></tr>
<tr><td>Band saw</td><td>Wood shop</td><td>Anyone</td><td>First come</td></tr></table>
<h3>Opening up</h3>
<ol><li>Switch on the main lights by the door.</li><li>Open the skylight vents if it is warm.</li><li>Check the first-aid kit is stocked.</li><li>Write your name in the day book.</li></ol>
<div class="tp-footer">1</div>`,
  },
  {
    id: 'letter',
    name: 'template.letter',
    html: `
<p class="tp-name">Your Name</p>
<p class="tp-small">Street Address · Town, Postcode · 01234 567890 · you@example.org</p>
<p class="tp-gap">18 November 2026</p>
<p class="tp-gap tp-tight">Recipient Name<br>Title, Organisation<br>Street Address<br>Town, Postcode</p>
<p class="tp-gap">Dear Recipient,</p>
<p>Begin with a sentence that says why you are writing. Keep each paragraph short and focused, and close with what you would like to happen next.</p>
<p>Thank you for your time.</p>
<p>Yours sincerely,</p>
<p class="tp-gap">Your Name</p>`,
  },
  {
    id: 'resume',
    name: 'template.resume',
    html: `
<p class="tp-name">Sam Okafor</p>
<p class="tp-small">Furniture designer · sam@example.org · portfolio.example.org</p>
<h3 class="tp-section">Experience</h3>
<p class="tp-row"><span>Lead designer, Oak &amp; Ash Workshop</span><span>2022 – present</span></p>
<p class="tp-row"><span>Bench joiner, Northgate Interiors</span><span>2018 – 2022</span></p>
<h3 class="tp-section">Education</h3>
<p class="tp-row"><span>BA Furniture Design, Coastal School of Art</span><span>2018</span></p>
<h3 class="tp-section">Skills</h3>
<p class="tp-small">Hand joinery, CAD, steam bending, finishing, client briefs</p>`,
  },
];
