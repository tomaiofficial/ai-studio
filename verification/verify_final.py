import asyncio
from playwright.async_api import async_playwright
import json
import os
from datetime import datetime

async def run_verification():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(
            geolocation={"latitude": 45.7640, "longitude": 4.8357},
            permissions=["geolocation"]
        )
        page = await context.new_page()

        # Mock Open-Meteo API
        now_hour = datetime.now().hour
        # Create a list of 48 zeros and then inject our test values at the current hour
        precip_probs = [0] * 48
        precip_probs[now_hour] = 0   # Maint
        precip_probs[(now_hour + 1) % 48] = 4
        precip_probs[(now_hour + 2) % 48] = 5
        precip_probs[(now_hour + 3) % 48] = 50

        await page.route("https://api.open-meteo.com/v1/forecast*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "current": {
                    "temperature_2m": 12.5,
                    "weather_code": 61,  # Pluie
                    "is_day": 1,
                    "relative_humidity_2m": 80,
                    "apparent_temperature": 10.0,
                    "wind_speed_10m": 15,
                    "visibility": 5000,
                    "pressure_msl": 1012
                },
                "hourly": {
                    "temperature_2m": [12.5] * 48,
                    "weather_code": [61] * 48,
                    "is_day": [1] * 48,
                    "precipitation_probability": precip_probs
                },
                "daily": {
                    "weather_code": [61] * 10,
                    "temperature_2m_max": [15] * 10,
                    "temperature_2m_min": [10] * 10,
                    "uv_index_max": [2] * 10
                }
            })
        ))

        # Mock BigDataCloud reverse geocoding
        await page.route("https://api.bigdatacloud.net/data/reverse-geocode-client*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"city": "Lyon"})
        ))

        # Load the page
        await page.goto(f"file://{os.getcwd()}/index.html")
        await page.wait_for_selector("#weather[style='display: block;']")

        # 1. Check City Name
        city = await page.inner_text("#city")
        print(f"City: {city}")
        assert city == "Lyon"

        # 2. Check "Maint" label
        first_hour_time = await page.inner_text(".hour:first-child .hour-time")
        print(f"First hour time: {first_hour_time}")
        assert first_hour_time == "Maint"

        # 3. Check Consistency (Maint vs Current)
        current_temp = await page.inner_text("#temp")
        first_hour_temp = await page.inner_text(".hour:first-child .hour-temp")
        print(f"Current Temp: {current_temp}, First Hour Temp: {first_hour_temp}")
        assert current_temp == "13°"
        assert first_hour_temp == "13°"

        # 4. Check Precipitation visibility
        precips = await page.eval_on_selector_all(".precip", "elements => elements.map(e => e.textContent)")
        print(f"Precipitation labels (first 5): {precips[:5]}")
        assert precips[0] == ""    # 0%
        assert precips[1] == ""    # 4%
        assert precips[2] == "5%"   # 5%
        assert precips[3] == "50%"  # 50%

        # Take screenshot
        await page.screenshot(path="verification/final_screenshot.png")
        print("Final screenshot saved.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_verification())
