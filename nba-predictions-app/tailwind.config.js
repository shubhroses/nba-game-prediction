/** @type {import('tailwindcss').Config} */

// A color of the page is a variable of src/index.css, which gives it one
// value for the light theme and one for the dark. A class such as bg-surface
// or text-ink therefore follows the visitor's theme by itself, and no
// component writes a dark: variant.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const withSoft = (name) => ({ DEFAULT: token(name), soft: token(`${name}-soft`) });

// The bar of tabs stays at the top of the window while the page scrolls. It
// is 44px high with a line of 1px under it, and what stays under it or is
// scrolled to under it goes by that height.
const TABS_REM = 2.8125;

export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        // These replace the palette of Tailwind. A class of a color that is
        // not in this list, such as bg-gray-100, does not exist.
        colors: {
            transparent: "transparent",
            current: "currentColor",
            white: "#ffffff",
            page: token("page"),
            surface: token("surface"),
            sunken: token("sunken"),
            line: token("line"),
            ink: token("ink"),
            muted: token("muted"),
            faint: token("faint"),
            // The three sources: Points & Rest, Elo and the sportsbooks.
            pr: withSoft("pr"),
            elo: withSoft("elo"),
            books: withSoft("books"),
            win: withSoft("win"),
            loss: withSoft("loss"),
            warn: withSoft("warn"),
            "on-fill": token("on-fill"),
            header: {
                DEFAULT: token("header"),
                ink: token("header-ink"),
                muted: token("header-muted"),
            },
            accent: token("accent"),
            focus: token("focus"),
        },
        extend: {
            // Sizes of the frame of the page that a view has to agree with. A
            // view names them, as in -mx-gutter, top-tabs and scroll-mt-below-tabs,
            // and so follows the frame when it changes.
            spacing: {
                // The room that the frame leaves at either side of the page.
                gutter: "1rem",
                // The height of the bar of tabs.
                tabs: `${TABS_REM}rem`,
                // Where something that the page is scrolled to comes to rest: clear of the tabs, with a little room.
                // src/index.css gives this margin to everything in the content that can take the focus.
                "below-tabs": `${TABS_REM + 1.1875}rem`,
            },
            borderColor: {
                DEFAULT: token("line"),
            },
            boxShadow: {
                card: "var(--shadow-card)",
            },
        },
    },
    // A style for the pointer over a control is given only where there is a
    // pointer that can rest over one. On a touch screen it would stay on the
    // control after a tap, until the next tap elsewhere.
    future: {
        hoverOnlyWhenSupported: true,
    },
    plugins: [],
}
