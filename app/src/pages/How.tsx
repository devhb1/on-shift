import { BrandMark } from "../components/BrandMark";
import { NetworkNote } from "../components/ui";
import { deployment, explorerAddress } from "../lib/config";
import { ThemeToggle, navigate } from "../App";

type Step = { name: string; detail: string };

function Flow({ title, caption, steps }: { title: string; caption: string; steps: Step[] }) {
  return (
    <section className="how-block">
      <h2 className="how-kicker">{title}</h2>
      <p>{caption}</p>
      <div className="flow">
        {steps.map((step, i) => (
          <div className="flow-step" key={step.name}>
            <div className="flow-node">
              <b>{step.name}</b>
              <span>{step.detail}</span>
            </div>
            {i < steps.length - 1 && <span className="flow-arrow" aria-hidden>→</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function How() {
  const d = deployment;
  const org = d?.orgName ?? "onshift.eth";
  return (
    <div className="public">
      <nav className="public-nav">
        <button className="row" style={{ color: "var(--label)", fontWeight: 700, background: "none", border: 0, cursor: "pointer", letterSpacing: "-0.03em" }} onClick={() => navigate("home")}>
          <BrandMark size={26} />
          OnShift
        </button>
        <div className="row">
          <ThemeToggle />
          <a href="#/try">Playground</a>
          <a href="#/verify">Public Check</a>
          <a href="#/overview">Console</a>
        </div>
      </nav>
      <NetworkNote compact />
      <article className="guide">
        <p className="landing-eyebrow" style={{ color: "var(--violet)" }}>How a person uses this, today</p>
        <h1 className="hero-title">One name. One shift. A receipt for every step.</h1>
        <p className="hero-sub">
          OnShift is live on Sepolia as {org}. A stranger does not get a staff pass. They either check a name, or they mint a sandbox pass under demo.{org}. The organisation wallet is the only one that can issue real staff.
        </p>

        <div className="how-roles">
          <div>
            <b>You were DMed</b>
            <span>Open Public Check. Paste the name. On shift or not is read from the chain. A demo name is marked DEMO. A look-alike org is flagged.</span>
          </div>
          <div>
            <b>You want to try it</b>
            <span>Playground. Connect a wallet with a little Sepolia ETH. Issue a Demo cashier or Demo agent. The page shows the transaction. Then pay the sandbox till and refund from the staff app.</span>
          </div>
          <div>
            <b>You run the org</b>
            <span>Console, with the wallet that owns {org}. New Pass writes shift-….ops.{org}. That pass can refund production orders. Playground passes cannot.</span>
          </div>
        </div>

        <Flow
          title="Try it, in order"
          caption="This is the path a new wallet can finish without being a shift lead."
          steps={[
            { name: "Playground", detail: "One transaction. A name under demo." },
            { name: "Pay sandbox", detail: "test USDC into the sandbox gate. You get an order id." },
            { name: "Staff app", detail: "The holder refunds that order. The payer is chosen by the order, not by the holder." },
            { name: "Public Check", detail: "Same name. On shift, role, time left, and the registry proof." },
          ]}
        />

        <Flow
          title="What the issue transaction does"
          caption="Playground calls tryIt. Production New Pass calls issue. Both end as an ENSv2 name."
          steps={[
            { name: "Your wallet", detail: "Signs tryIt or issue. Pays the gas and a 0.003 ETH allowance for the holder." },
            { name: "PassIssuer", detail: "Checks the cap, the duration, and which registry. Demo names cannot use staff role names." },
            { name: "New resolver", detail: "VerifiableFactory deploys one Permissioned Resolver for this pass. The holder may write only shift.status." },
            { name: "UserRegistry", detail: "Registers the label with roleBitmap 0 and an expiry. It cannot be transferred." },
          ]}
        />

        <Flow
          title="Where the money goes"
          caption="A demo pass and a staff pass do not share a till. Paying the shop does not create an order a demo pass can refund."
          steps={[
            { name: "Customer", detail: "pay() on the sandbox gate, or on the production till." },
            { name: "Order", detail: "The id is derived from the gate, the payer, and a nonce. Nobody else can claim it." },
            { name: "Holder", detail: "refund(label, order, amount). The contract sends test USDC to the payer." },
            { name: "Refused", detail: "Unknown order, over the cap, over what was paid, or the pass is not live." },
          ]}
        />

        <Flow
          title="Why “it resolves” is not “on shift”"
          caption="Public Check shows both. Liveness is the registry. The text records are what a wallet sees."
          steps={[
            { name: "getState", detail: "REGISTERED and the expiry is still ahead. This is the only liveness check." },
            { name: "Universal Resolver", detail: "org, role, shift.status. A wallet uses this path." },
            { name: "Expiry", detail: "When the time passes, getState is no longer registered. No revoke transaction is required." },
            { name: "Break glass", detail: "One org transaction re-points ops. Every staff pass fails. Old names do not come back." },
          ]}
        />

        {d && (
          <section className="how-block">
            <h2>The contracts you can open</h2>
            <p>These are the Sepolia addresses this app reads. A pass that is not in a transaction to one of them is not a pass.</p>
            <div className="how-links">
              <a href={explorerAddress(d.passIssuer)} target="_blank" rel="noreferrer">PassIssuer ↗</a>
              <a href={explorerAddress(d.playground ?? d.passIssuer)} target="_blank" rel="noreferrer">Playground ↗</a>
              <a href={explorerAddress(d.sandboxGate ?? d.shiftGate)} target="_blank" rel="noreferrer">Sandbox gate ↗</a>
              <a href={explorerAddress(d.shiftGate)} target="_blank" rel="noreferrer">Production gate ↗</a>
              <a href={`https://sepolia.app.ens.domains/${org}`} target="_blank" rel="noreferrer">{org} ↗</a>
            </div>
          </section>
        )}

        <div className="play-actions" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={() => navigate("try")}>
            Start in the Playground
          </button>
          <button className="btn" onClick={() => navigate("verify")}>
            Check a name
          </button>
        </div>
      </article>
    </div>
  );
}
