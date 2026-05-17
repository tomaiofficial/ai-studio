import asyncio
from playwright.async_api import async_playwright
import json
import os

async def run_verification():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()

        # Mock Geocoding API
        await page.route("https://geocoding-api.open-meteo.com/v1/search*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"results": [{"name": "Paris", "latitude": 48.8566, "longitude": 2.3522}]})
        ))

        # Mock Weather API
        await page.route("https://api.open-meteo.com/v1/forecast*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "current": {"temperature_2m": 20, "weather_code": 0, "is_day": 1, "relative_humidity_2m": 50, "apparent_temperature": 19, "wind_speed_10m": 10, "visibility": 10000, "pressure_msl": 1013},
                "hourly": {"temperature_2m": [20]*48, "weather_code": [0]*48, "is_day": [1]*48, "precipitation_probability": [0]*48},
                "daily": {"weather_code": [0]*10, "temperature_2m_max": [22]*10, "temperature_2m_min": [15]*10, "uv_index_max": [5]*10}
            })
        ))

        await page.goto(f"file://{os.getcwd()}/index.html")
        await page.wait_for_selector("#weather[style='display: block;']")

        # 1. Check if sidebar opens
        await page.click("text=☰")
        await page.wait_for_timeout(500)
        sidebar_active = await page.evaluate("document.getElementById('sidebar').classList.contains('active')")
        print(f"Sidebar active: {sidebar_active}")
        assert sidebar_active is True

        # Close sidebar using the '×' button inside it
        await page.locator("#sidebar .close-btn").click()
        await page.wait_for_timeout(500)
        sidebar_active = await page.evaluate("document.getElementById('sidebar').classList.contains('active')")
        print(f"Sidebar closed: {not sidebar_active}")
        assert sidebar_active is False

        # 2. Check if settings modal opens
        await page.click("text=⚙")
        await page.wait_for_timeout(500)
        modal_active = await page.evaluate("document.getElementById('settings-modal').classList.contains('active')")
        print(f"Settings modal active: {modal_active}")
        assert modal_active is True

        # 3. Check temperature unit toggle
        await page.click("text=°F")
        # Wait for the temperature to update
        await page.wait_for_function("document.getElementById('temp').textContent.includes('68°')")
        temp_text = await page.inner_text("#temp")
        print(f"Temp in F: {temp_text}")
        assert "68°" in temp_text

        # Close modal
        await page.locator("#settings-modal .close-btn").click()
        await page.wait_for_timeout(500)

        # 4. Check location saving
        # Search for London
        await page.route("https://geocoding-api.open-meteo.com/v1/search*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"results": [{"name": "London", "latitude": 51.5, "longitude": -0.1, "country": "UK"}]})
        ))
        await page.fill("#search", "London")
        await page.press("#search", "Enter")
        await page.wait_for_selector("text=London")

        # Re-open sidebar and check if London is there
        await page.click("text=☰")
        await page.wait_for_timeout(500)
        locations = await page.inner_text("#locations-list")
        print(f"Saved locations: {locations}")
        assert "London" in locations

        # 5. Check Mobile Restrictions
        user_select = await page.evaluate("getComputedStyle(document.body).userSelect")
        print(f"User select: {user_select}")
        assert user_select == "none"

        viewport = await page.get_attribute("meta[name='viewport']", "content")
        print(f"Viewport: {viewport}")
        assert "user-scalable=no" in viewport

        await page.screenshot(path="verification/features_screenshot.png")
        print("Verification successful, screenshot saved.")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_verification())
