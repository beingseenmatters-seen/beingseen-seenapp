const apiKey = process.env.VITE_FIREBASE_API_KEY;
const email = "test@example.com";
const continueUrl = "https://app.beingseenmatters.com/auth/verify";

async function test() {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: "EMAIL_SIGNIN",
      email,
      continueUrl,
      canHandleCodeInApp: true,
      returnOobLink: true
    })
  });
  const data = await res.json();
  console.log(data);
}
test();
