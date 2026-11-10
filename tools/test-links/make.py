# Builds test PDFs and photos with known links. Writes expected.json: file -> [[target, ideal label], ...]
import json, io, qrcode, os
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont, ImageFilter
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fx'); os.makedirs(D, exist_ok=True); E = {}
def qr(data, px=300):
    q = qrcode.QRCode(border=2, box_size=10); q.add_data(data); q.make(fit=True)
    return q.make_image(fill_color='black', back_color='white').convert('RGB').resize((px, px), Image.NEAREST)
def font(sz, bold=True):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
W, H = letter

# 1. Bulletin, 2 pages, text PDF
c = canvas.Canvas(f'{D}/bulletin.pdf', pagesize=letter)
c.setFont('Helvetica-Bold', 26); c.drawString(50, H-70, 'Sunday, November 9')
c.setFont('Helvetica-Bold', 16); c.drawString(60, H-130, 'Sign up for Baptism')
c.drawImage(ImageReader(qr('https://www.bethanynaz.org/baptism')), 60, H-290, 140, 140)
c.drawString(330, H-130, 'Give Online')
c.drawImage(ImageReader(qr('https://pushpay.com/g/bethanyfirst')), 330, H-290, 140, 140)
c.setFont('Helvetica', 12)
c.drawString(50, H-340, 'Questions? Email Pastor Thaddeus at thaddeus@bethanynaz.org')
c.drawString(50, H-370, 'Visit bethanynaz.org/serve to find a place to serve.')
c.setFont('Helvetica-Bold', 13); c.drawString(50, H-410, 'Watch the sermon'); c.linkURL('https://www.youtube.com/@bethanyfirst', (48, H-414, 170, H-396))
c.setFont('Helvetica', 11); c.drawString(50, H-450, 'Service times: 9:00 and 10:45 a.m. in Room 2.5. St. John 3:16.')
c.showPage()
c.setFont('Helvetica-Bold', 18); c.drawString(50, H-70, 'Kids Ministry')
c.setFont('Helvetica', 12); c.drawString(50, H-100, 'Register your kids'); c.linkURL('https://bethanynaz.churchcenter.com/registrations/events/12345', (48, H-104, 160, H-88))
c.drawString(50, H-140, 'Office hours: office@bethanynaz.org')
c.drawString(50, H-170, 'Small Groups: find one at bethanynaz.org/group-life')
c.drawString(50, H-200, 'Contact Sarah Miller'); c.linkURL('mailto:sarah.miller@bethanynaz.org', (48, H-204, 170, H-188))
c.drawString(50, H-230, 'Call the church office'); c.linkURL('tel:+14057891234', (48, H-234, 180, H-218))
c.drawString(50, H-260, 'Our new site: bethany.church')
c.save()
E['bulletin.pdf'] = [['https://www.bethanynaz.org/baptism', 'Sign up for Baptism'], ['https://pushpay.com/g/bethanyfirst', 'Give Online'],
  ['mailto:thaddeus@bethanynaz.org', 'Email Pastor Thaddeus'], ['https://bethanynaz.org/serve', ['Serve', 'Find a place to serve']], ['https://www.youtube.com/@bethanyfirst', 'Watch the sermon'],
  ['https://bethanynaz.churchcenter.com/registrations/events/12345', 'Register your kids'], ['mailto:office@bethanynaz.org', 'Email the office'],
  ['https://bethanynaz.org/group-life', 'Small Groups'], ['mailto:sarah.miller@bethanynaz.org', 'Email Sarah'], ['tel:+14057891234', 'Call the church office'],
  ['https://bethany.church', ['Bethany', 'Bethany.church']]]

# 2. Two-column flyer PDF, QR under headings, labels below
c = canvas.Canvas(f'{D}/two-qr.pdf', pagesize=letter)
c.setFont('Helvetica-Bold', 30); c.drawCentredString(W/2, H-80, 'FALL FESTIVAL')
c.setFont('Helvetica-Bold', 18)
c.drawCentredString(170, H-160, 'VOLUNTEER'); c.drawImage(ImageReader(qr('https://forms.gle/AbC123xyz')), 95, H-330, 150, 150)
c.drawCentredString(440, H-160, 'RSVP'); c.drawImage(ImageReader(qr('https://bethanynaz.org/fall-festival')), 365, H-330, 150, 150)
c.setFont('Helvetica', 11); c.drawCentredString(170, H-350, 'Scan to sign up'); c.drawCentredString(440, H-350, 'Scan to RSVP')
c.save()
E['two-qr.pdf'] = [['https://forms.gle/AbC123xyz', 'Volunteer'], ['https://bethanynaz.org/fall-festival', 'RSVP']]

# 3. URL split across two lines + split email
c = canvas.Canvas(f'{D}/wrapped.pdf', pagesize=letter)
c.setFont('Helvetica', 12)
c.drawString(50, H-80, 'Register online at https://www.bethanynaz.org/events/')
c.drawString(50, H-96, 'womens-retreat by Nov 20.')
c.drawString(50, H-140, 'Youth questions: john.smith @ bethanynaz.org')
c.save()
E['wrapped.pdf'] = [['https://www.bethanynaz.org/events/womens-retreat', 'Register online'], ['mailto:john.smith@bethanynaz.org', 'Email John']]

# Photo flyers
def flyer(name, size, draw):
    im = Image.new('RGB', size, 'white'); d = ImageDraw.Draw(im); draw(im, d); return im
# 4. Photo: heading above a QR
im = flyer('a', (1200, 1600), lambda im, d: (d.text((120, 120), 'Join a Small Group', font=font(80), fill='black'), im.paste(qr('https://www.bethanynaz.org/group-life', 600), (300, 330)), d.text((120, 1050), 'Groups start the week of Jan 12', font=font(48, False), fill='black')))
im.save(f'{D}/photo-group.png'); E['photo-group.png'] = [['https://www.bethanynaz.org/group-life', 'Join a Small Group']]
# 5. Photo: three QRs in a row with labels below
def three(im, d):
    for i, (lab, url) in enumerate([('Give', 'https://pushpay.com/g/bethanyfirst'), ('Connect Card', 'https://bethanynaz.org/connect'), ('Prayer', 'https://bethanynaz.org/prayer')]):
        im.paste(qr(url, 360), (60 + i * 420, 200)); f = font(52); w = d.textlength(lab, font=f); d.text((60 + i * 420 + 180 - w / 2, 590), lab, font=f, fill='black')
    d.text((60, 60), 'Next Steps', font=font(80), fill='black')
im = flyer('b', (1340, 760), three); im.save(f'{D}/photo-three.png')
E['photo-three.png'] = [['https://pushpay.com/g/bethanyfirst', 'Give'], ['https://bethanynaz.org/connect', 'Connect Card'], ['https://bethanynaz.org/prayer', 'Prayer']]
# 6. Photo with a written web address only (OCR)
im = flyer('c', (1400, 700), lambda im, d: (d.text((80, 100), 'Give online', font=font(90), fill='black'), d.text((80, 300), 'bethanynaz.org/give', font=font(80, False), fill='#1d4ed8'), d.text((80, 470), 'Email: giving@bethanynaz.org', font=font(56, False), fill='black')))
im.save(f'{D}/photo-text.png'); E['photo-text.png'] = [['https://bethanynaz.org/give', 'Give online'], ['mailto:giving@bethanynaz.org', 'Email us']]
# 7. Phone photo of a flyer: rotated, blurred, JPEG, colored background
base = flyer('d', (1200, 1500), lambda im, d: (d.rectangle((0, 0, 1200, 1500), fill='#fde68a'), d.text((140, 120), 'Christmas Eve', font=font(96), fill='#7c2d12'), d.text((140, 260), 'Save your seat', font=font(64), fill='#7c2d12'), im.paste(qr('https://bethanynaz.org/christmas', 560), (320, 420))))
photo = base.rotate(8, expand=True, fillcolor='#555555').filter(ImageFilter.GaussianBlur(1.2)).resize((900, 1110))
photo.save(f'{D}/photo-camera.jpg', quality=70); E['photo-camera.jpg'] = [['https://bethanynaz.org/christmas', 'Save your seat']]
# 8. Scanned PDF: an image-only page with text + QR
pg = flyer('e', (1700, 2200), lambda im, d: (d.text((150, 150), 'Prayer Requests', font=font(90), fill='black'), im.paste(qr('https://bethanynaz.org/prayer', 500), (150, 320)), d.text((750, 450), 'Or email pray@bethanynaz.org', font=font(52, False), fill='black')))
pg = pg.filter(ImageFilter.GaussianBlur(0.6)); buf = io.BytesIO(); pg.save(buf, 'JPEG', quality=75)
c = canvas.Canvas(f'{D}/scanned.pdf', pagesize=letter); c.drawImage(ImageReader(io.BytesIO(buf.getvalue())), 0, 0, W, H); c.save()
E['scanned.pdf'] = [['https://bethanynaz.org/prayer', 'Prayer Requests'], ['mailto:pray@bethanynaz.org', 'Email us']]
# 9. Noise only: no links at all
c = canvas.Canvas(f'{D}/no-links.pdf', pagesize=letter); c.setFont('Helvetica', 12)
for i, t in enumerate(['Doors open at 10.30 a.m.', 'Version 2.0 of our handbook', 'Read Acts 2.42 this week', 'Email the office with questions', 'e.g. bring a dish', 'Mr. Smith and Dr. Lee will lead.', 'Total: $1,234.56']):
    c.drawString(50, H - 80 - i * 24, t)
c.save(); E['no-links.pdf'] = []
json.dump(E, open(os.path.join(os.path.dirname(__file__), 'expected.json'), 'w'), indent=1)
print('ok', len(E))
