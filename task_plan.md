# UX Animation Overhaul Plan

## Goal
Make the site lively with staggered entry animations, smooth hover effects, and polished interactive elements across all pages — SignIn through AdminInvigilators.

## Reference Format
The ExamSetupPage is the baseline. All pages should exceed its simplicity with animations while keeping its dark theme colors.

## Phases

### Phase 1: Core CSS Animation Utilities ✅
Enhance `index.css` with reusable animation classes:
- Page entry animation (fadeInUp with stagger)
- Card hover lift effect (card-hover already exists, enhance)
- Button press/ripple effect
- Skeleton/shimmer loading (already exists, enhance)
- Smooth transitions on all interactive elements
- Badge pulse for active states
- Toast/notification animations (already exist)
- Progress bar gradient animation
- Table row slide-in

### Phase 2: Sign In Page 🔄
- Full-page entry animation
- Form card slide-up with delay
- Input focus glow animation
- Button hover scale + glow
- Sidebar image parallax/shift effect

### Phase 3: Dashboard Page
- Staggered metric card entry
- Card hover lift
- Quick actions section with gradient animation
- Import/Export button animations
- Activity log fade-in

### Phase 4: Student Management Page
- Form card entry
- Table row stagger animations
- Modal scale+fade
- Search input focus animation
- Button group animations

### Phase 5: Fingerprint Enrollment Page
- Scanner visualization pulse
- Progress bar smooth animation
- Status indicator pulse
- Step indicators checkmark animation
- Card entry stagger

### Phase 6: Exam Setup Page (already good, but enhance)
- Form entries slide in
- Session list items stagger
- Button animations

### Phase 7: Attendance Page
- Fingerprint gate animation
- Progress steps animation
- Status messages slide
- Scanner area pulse

### Phase 8: Monitoring Page ✅
- Camera feed border glow ✅
- Alert cards slide-in ✅
- Risk meter animation ✅
- Face detection box pulse ✅

### Phase 9: Reporting Page
- Stat cards stagger entry
- Progress bar smooth fill
- Table rows stagger
- Filter buttons toggle animation
- AI report card slide-in

### Phase 10: Admin Invigilators Page
- Form card entry
- Bulk results expand animation
- Password reveal animation
- Table row animations
- Success/error message transitions

### Phase 11: Components (Navbar, AI Assistant, Sync Banner)
- Navbar link hover underline
- AI panel accordion transitions
- Sync banner slide-up/down

## Constraints
- No external animation libraries (keep it CSS + inline styles)
- Must not break existing functionality
- Dark theme colors must be maintained
- Performance: prefer CSS animations over JS
- Mobile responsive: animations should degrade gracefully
