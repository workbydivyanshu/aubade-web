# UI Audit: Home & Album Screens

| Screen | Element | Reference | Aubade | Delta | Severity |
| --- | --- | --- | --- | --- | --- |
| Home | Hero Card Corner Radius | r:0px | r:16px | 16px difference | High |
| Home | Hero Card Cover Radius | r:36px | r:8px | 28px difference | High |
| Home | Shelf Card Cover Radius | r:36px | r:8px | 28px difference | High |
| Album | Control Buttons Alignment | Left-aligned (starts at x:608) | Centered (starts at x:613, W:99) | The reference buttons are left-aligned; Aubade is centered | High |
| Album | Control Buttons Count | 7 buttons (incl Play [w:119 h:48], others [w:48 h:48]) | 3 buttons (incl Play [w:99 h:48], others [w:48 h:48]) | 4 buttons missing in Aubade | High |
| Home | "See all" Button Position | Y:625, aligned with subtitle (Y:635) | Y:568, aligned with title (Y:568) | 57px vertical difference | Medium |
| Home | Hero Card Title Size | sz:36px, lh:40px | sz:48px, lh:50.4px | 12px font size difference | Medium |
| Home | Top Shelf Cards Height | h:60px | h:56px | 4px difference | Medium |
| Home | Top Shelf Card Radius | r:20px | r:10px | 10px difference | Medium |
| Album | Header Elements Y-Position | Title at Y:545 | Title at Y:479 | ~66px vertical shift | Medium |
| Album | Track List Layout (X offsets) | Num: x:380, Title: x:412, Dur: x:1256 | Num: x:392, Title: x:424, Dur: x:1278 | ~12-22px horizontal shift | Medium |
| Home | Page Greeting Line-Height | lh:40px | lh:39.6px | 0.4px difference | Low |
| Home | Filter Pill Radius | r:33554432px | r:9999px | Different values for full round | Low |
| Home | Shelf Title Line-Height | lh:32px | lh:28.8px | 3.2px difference | Low |
| Home | Shelf Subtitle Line-Height | lh:20px | lh:18.2px | 1.8px difference | Low |
| Home | Hero Card Eyebrow Line-Height | lh:16px | lh:12px | 4px difference | Low |
| Home | Hero Card Play Button Height | h:40px | h:48px | 8px difference | Low |
| Home | Hero Card Extra Button Size | w:44px h:44px | w:48px h:48px | 4px difference | Low |
| Album | Album Cover Shadow | sh:rgba(0, 0, 0, 0) 0px | sh:rgba(0, 0, 0, 0.6) 0 | Shadow is visible in Aubade | Low |
| Album | Album Eyebrow Line-Height | lh:16px | lh:normal | Explicit vs normal line-height | Low |
| Album | Album Title Line-Height | lh:48px | lh:52.8px | 4.8px difference | Low |
| Album | Album Artist Line-Height | lh:24px | lh:normal | Explicit vs normal line-height | Low |
| Album | Album Metadata Line-Height | lh:20px | lh:normal | Explicit vs normal line-height | Low |

## Unmeasured Elements
Could not measure hover states, transitions, animations, or scroll behavior because the JSON capture only represents a static snapshot of the DOM. I also could not measure pseudo-elements unless they rendered as discrete bounding boxes in the audit harness.

## Summary
- High Severity: 5
- Medium Severity: 6
- Low Severity: 12