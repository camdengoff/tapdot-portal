import json, os, qrcode
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fx2'); os.makedirs(D, exist_ok=True); E = {}; W, H = letter
def qr(data, px=300, fg='black', bg='white'):
    q = qrcode.QRCode(border=2, box_size=10); q.add_data(data); q.make(fit=True)
    return q.make_image(fill_color=fg, back_color=bg).convert('RGB').resize((px, px), Image.NEAREST)
def font(sz, bold=True): return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf' % ('-Bold' if bold else ''), sz)
import urllib.request
B = 'https://images.squarespace-cdn.com/content/v1/65bd0491a7175b60fff4706b/'
for name, path in [('grief-share', '6503f572-dbd8-46c6-9832-44778df0b8e2/grief+share.png'), ('young-adults', '1733177953739-PQJX370B600Z79Z70OHO/Young+Adults.png'),
    ('celebrate-recovery', '1733173411167-M1N8LDI95NSWKSUZK488/Celebrate+Recovery.png'), ('garage-guys', '1733174207263-HBIA8TPMON0Z4KZ9P36L/Garage+Guys.png'),
    ('rediscover', '73ead88c-37eb-4f35-8e08-556a399a748a/DISCOVER.png')]:
    out = f'{D}/bfc-{name}.png'
    if not os.path.exists(out):
        try: urllib.request.urlretrieve(B + path + '?format=1500w', out)
        except Exception as e: print('skipped', name, e)
for f in sorted(os.listdir(D)):
    if f.startswith('bfc-'): E[f] = []   # real Bethany flyers: words like "Learn More" but no links
# Two-column newsletter: two links on the same height in different columns
c = canvas.Canvas(f'{D}/columns.pdf', pagesize=letter); c.setFont('Helvetica-Bold', 14)
c.drawString(50, H-80, 'Generosity'); c.drawString(320, H-80, 'Students')
c.setFont('Helvetica', 11)
c.drawString(50, H-100, 'Give: pushpay.com/g/bethanyfirst'); c.drawString(320, H-100, 'Youth: bethanynaz.org/youth')
c.drawString(50, H-130, 'Follow us: facebook.com/bethanyfirstchurch'); c.drawString(320, H-130, '(see bethanynaz.org/events).')
c.drawString(50, H-160, 'CONTACT: OFFICE@BETHANYNAZ.ORG')
c.setFont('Helvetica-Bold', 14); c.drawString(50, H-200, 'Baptism Class')
c.setFont('Helvetica', 11); c.drawString(50, H-218, 'Learn more'); c.linkURL('https://bethanynaz.org/baptism-class', (48, H-222, 110, H-206))
c.drawImage(ImageReader(qr('https://pushpay.com/g/bethanyfirst', 200)), 320, H-260, 0.01, 0.01)  # tiny invisible image, ignored
c.rect(320, H-240, 120, 30, fill=0); c.linkURL('https://tithe.ly/give?c=12345', (320, H-240, 440, H-210))
c.showPage()
c.setFont('Helvetica-Bold', 14); c.drawString(50, H-80, 'Generosity')
c.setFont('Helvetica', 11); c.drawString(50, H-100, 'Give: pushpay.com/g/bethanyfirst')
c.save()
E['columns.pdf'] = [['https://pushpay.com/g/bethanyfirst', 'Give', 0], ['https://bethanynaz.org/youth', 'Youth', 1], ['https://facebook.com/bethanyfirstchurch', ['Facebook', 'Follow us'], 1],
  ['https://bethanynaz.org/events', ['See events', 'Events'], 1], ['mailto:office@bethanynaz.org', 'Email the office', 1], ['https://bethanynaz.org/baptism-class', 'Baptism Class', 1],
  ['https://tithe.ly/give?c=12345', 'Give', 1]]
# Dark flyer with a white-on-dark QR, a mailto QR, a tel QR, a Wi-Fi QR (not a link), and a tiny QR in a big photo
def dark(im, d):
    d.rectangle((0, 0, 2000, 1400), fill='#14213d')
    d.text((80, 80), 'Wednesday Night', font=font(90), fill='white')
    d.text((100, 260), 'Watch Live', font=font(46), fill='#fca311'); im.paste(qr('https://youtube.com/@bethanyfirst/live', 380, 'white', '#14213d'), (100, 350))
    d.text((620, 260), 'Email Pastor Mike', font=font(46), fill='#fca311'); im.paste(qr('mailto:mike.jones@bethanynaz.org', 380), (620, 350))
    d.text((1180, 260), 'Call the office', font=font(46), fill='#fca311'); im.paste(qr('tel:+14057891234', 380), (1180, 350))
    d.text((100, 820), 'Guest Wi-Fi', font=font(50), fill='white'); im.paste(qr('WIFI:T:WPA;S:BFC Guest;P:welcome123;;', 260), (100, 900))
    im.paste(qr('https://bethanynaz.org/kids', 110), (1820, 1220)); d.text((1560, 1250), 'Kids check-in', font=font(34), fill='white')
im = Image.new('RGB', (2000, 1400)); dark(im, ImageDraw.Draw(im)); im.save(f'{D}/dark-flyer.jpg', quality=85)
E['dark-flyer.jpg'] = [['https://youtube.com/@bethanyfirst/live', 'Watch Live'], ['mailto:mike.jones@bethanynaz.org', 'Email Pastor Mike'], ['tel:+14057891234', 'Call the office'], ['https://bethanynaz.org/kids', 'Kids check-in']]
json.dump(E, open(os.path.join(os.path.dirname(__file__), 'expected2.json'), 'w'), indent=1); print('ok', list(E))
