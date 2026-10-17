# MediCare+

Trustworthy, sterile-clean, calming blue.

## Overview

MediCare+ is a clinical design system for hospital portals and patient management systems. It prioritizes clarity, trust, and error prevention above all else. The calming blue palette is intentionally sterile — evoking the reliability of medical-grade environments. Standard density ensures that forms, data tables, and patient records are legible without ambiguity. Every component is designed with accessibility as a non-negotiable requirement (WCAG AA minimum), large touch targets for bedside tablets, and clear visual hierarchy that prevents critical misreadings.

## Colors

- **Primary** (#0077B6): Med Blue — primary actions, navigation, links
- **Secondary** (#48CAE4): Light Blue — supporting accents, charts, badges
- **Tertiary** (#90E0EF): Pale Cyan — highlights, progress bars, tags
- **Background** (#FAFCFF): Very pale blue-white page background
- **Surface** (#FFFFFF): Cards, panels, form containers
- **Success** (#059669)
- **Warning** (#D97706)
- **Error** (#DC2626)
- **Info** (#0077B6)

## Typography

- **Headline Font**: Figtree
- **Body Font**: Open Sans
- **Mono Font**: IBM Plex Mono

- **Display**: Figtree 34px bold, 1.2 line height, 0.02em tracking. Dashboard greetings, hero text.
- **Headline**: Figtree 26px bold, 1.3 line height, 0.01em tracking. Page titles, section headers.
- **Subhead**: Figtree 20px semibold, 1.4 line height. Card titles, panel headings.
- **Body Large**: Open Sans 18px regular, 1.6 line height. Important instructions, alerts.
- **Body**: Open Sans 16px regular, 1.6 line height. Default reading text, forms.
- **Body Small**: Open Sans 14px regular, 1.55 line height. Table cells, secondary info.
- **Caption**: Open Sans 12px medium, 1.5 line height, 0.01em tracking. Timestamps, record IDs.
- **Overline**: Open Sans 11px bold, 1.4 line height, 0.08em tracking. Status labels, section markers.
- **Code**: IBM Plex Mono 14px regular, 1.6 line height. Medical codes, IDs, data fields.

## Spacing

- **Base unit**: 8px
- **Scale**: 4, 8, 16, 24, 32, 40, 48, 64, 80
- **Component padding — small**: 8px
- **Component padding — medium**: 16px
- **Component padding — large**: 32px
- **Section spacing — mobile**: 40px
- **Section spacing — tablet**: 56px
- **Section spacing — desktop**: 80px

## Border Radius

- **None** (0px): Table cells, dividers
- **Small** (4px): Chips, badges, small inline elements
- **Medium** (8px): Buttons, inputs, cards, panels
- **Large** (12px): Modals, dialogs, large panels
- **XL** (16px): Onboarding cards, hero containers
- **Full** (9999px): Avatars, status indicators, pill badges
The default radius is 8px — professional and approachable, with enough rounding to feel friendly without being playful.

## Elevation

**Philosophy:** Subtle, clean shadows establish hierarchy in dense clinical interfaces. They must be gentle — no harsh edges or dramatic elevation that might distract from critical content.
- **Subtle**: 1px offset, 3px blur, #000000 at 6%; 1px offset, 2px blur, #000000 at 4%. Cards, form containers.
- **Medium**: 4px offset, 12px blur, #000000 at 7%; 1px offset, 3px blur, #000000 at 4%. Hovered cards, active panels.
- **Large**: 12px offset, 32px blur, #000000 at 8%; 4px offset, 8px blur, #000000 at 4%. Modals, critical alerts.
- **Overlay**: 20px offset, 48px blur, #000000 at 12%; 8px offset, 16px blur, #000000 at 6%. Dropdown menus, date pickers.
**Special — Blue Focus:** 2px ring #FAFCFF, 4px ring #0077B6 — high-visibility focus ring for keyboard and assistive technology users.
**Special — Error Halo:** 2px ring #FAFCFF, 4px ring #DC2626 — immediate visual alert for fields with validation errors.

## Components

### Buttons
- **Primary**: #0077B6 fill, #FFFFFF text, no border, 8px corners. Open Sans 15px semibold. 10px/24px padding, 44px (touch target) min height. Hover: Background #006399. Active: Background #005280.
- **Secondary**: #FFFFFF fill, #0077B6 text, 1.5px #0077B6 border, 8px corners. Open Sans 15px semibold. 10px/24px padding, 44px min height. Hover: Background #F0F7FF. Active: Background #E0EFFF.
- **Ghost**: transparent, #0077B6 text, no border, 8px corners. Open Sans 15px semibold. 10px/24px padding, 44px min height. Hover: Background #F0F7FF. Active: Background #E0EFFF.
- **Destructive**: #DC2626 fill, #FFFFFF text, no border, 8px corners. Open Sans 15px semibold. 10px/24px padding, 44px min height. Hover: Background #B91C1C. Active: Background #991B1B.
- **Sizes**: Small 8px 16px / 13px (min-height 36px), Medium 10px 24px / 15px (min-height 44px), Large 14px 32px / 16px (min-height 52px)
- **Disabled**: Background #E2E8F0, text #94A3B8, disabled cursor, no hover change.

### Cards
- **Default**: #FFFFFF fill, 1px #E2E8F0 border, 8px corners, 1px offset, 3px blur, #000000 at 6%; 1px offset, 2px blur, #000000 at 4% shadow. 24px padding. Hover: Shadow 0 4px 12px #000000 at 7%; 1px offset, 3px blur, #000000 at 4%.
- **Elevated**: #FFFFFF fill, 1px #E2E8F0 border, 8px corners, 4px offset, 12px blur, #000000 at 7%; 1px offset, 3px blur, #000000 at 4% shadow. 24px padding.

### Inputs
- **Text Input**: #FFFFFF fill, 1.5px #CBD5E1 border, 8px corners, #0F172A text. Open Sans 16px regular. 44px tall, 10px/14px padding, #94A3B8 placeholder color. Focus: Border #0077B6, ring 2px ring #FAFCFF, 4px ring #0077B6. Error: Border #DC2626, ring 2px ring #FAFCFF, 4px ring #DC2626. Disabled: Background #F8FAFC, border #E2E8F0, 60% opacity.
- **Label**: Open Sans, 14px, weight 600, color #0F172A, bottom margin 6px. Required fields append a red asterisk `*` in #DC2626.
- **Helper Text**: Open Sans, 13px, weight 400, color #475569, top margin 6px. Error helper color #DC2626, prefixed with a warning icon.

### Chips
- **Filter Chip**: #F0F7FF fill, 1px #CBD5E1 border, pill shape, #475569 text. Open Sans 13px semibold. 6px/14px padding. Selected: Background #0077B6, text #FFFFFF, border #0077B6. Hover: Background #E0EFFF.
- **Status Chip**: 4px corners. Open Sans 12px bold uppercase. 4px/12px padding, Background #ECFDF5, text #059669, border 1px #A7F3D0 success, Background #FFFBEB, text #D97706, border 1px #FDE68A warning, Background #F0F7FF, text #0077B6, border 1px #90E0EF info. Error: Background #FEF2F2, text #DC2626, border 1px #FECACA.

### Lists
- **Default List Item**: 1px #E2E8F0 border bottom, #0F172A text. Open Sans 16px regular. 14px/16px padding, #475569, 13px secondary text, 20px icon, color #0077B6 leading element, 48px (touch target) min height. Hover: Background #F0F7FF. Active: Background #E0EFFF.

### Checkboxes
20px (larger for clinical accuracy), 1.5px #CBD5E1 border, 4px corners, #FFFFFF fill. 44px minimum touch target. Checked: Background #0077B6, border #0077B6, checkmark #FFFFFF. Indeterminate: Background #0077B6, dash #FFFFFF. Hover: Border #0077B6, background #F0F7FF. Focus: Ring 2px ring #FAFCFF, 4px ring #0077B6. Disabled: Background #F8FAFC, 50% opacity. Labels in Open Sans 16px regular left margin 10px.

### Radio Buttons
20px (larger for clinical accuracy), 1.5px #CBD5E1 border, pill shape, #FFFFFF fill. 44px minimum touch target. Selected: Border #0077B6, inner dot #0077B6 (10px). Hover: Border #0077B6, background #F0F7FF. Focus: Ring 2px ring #FAFCFF, 4px ring #0077B6. Disabled: Background #F8FAFC, 50% opacity. Labels in Open Sans 16px regular left margin 10px.

### Tooltips
#0F172A fill, #FFFFFF text, 8px corners, 4px offset, 12px blur, #000000 at 12% shadow. Open Sans 13px medium. 8px/14px padding, 280px max width, 6px, same background arrow, 300ms enter, 100ms leave delay.

## Do's and Don'ts

1. **Do** meet WCAG AA contrast ratios (4.5:1 body text, 3:1 large text) at minimum — aim for AAA where possible.
2. **Do** make all interactive elements at least 44px touch target size for bedside tablet use.
3. **Do** always pair color-coded status indicators with text labels and icons — never rely on color alone.
4. **Don't** use red for anything other than errors, critical alerts, and destructive actions — misuse creates alarm fatigue.
5. **Do** prefix required form fields with a visible asterisk and provide clear validation messages before submission.
6. **Don't** auto-dismiss important notifications — critical medical information must require manual acknowledgment.
7. **Do** use IBM Plex Mono for all medical record numbers, codes, and dosage values to prevent misreading.
8. **Don't** use placeholder text as a substitute for labels — labels must always be visible and persistent.
9. **Do** provide high-contrast focus indicators on every interactive element for keyboard and assistive device navigation.
10. **Don't** use low-contrast grays for important data — patient safety depends on every value being immediately legible.