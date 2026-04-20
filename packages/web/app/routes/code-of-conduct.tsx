import { Link } from "react-router";

export default function CodeOfConduct() {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-semibold text-ink">Code of Conduct</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Adapted from the{" "}
          <a href="https://berlincodeofconduct.org/" className="text-dci-teal underline" rel="noopener noreferrer">
            Berlin Code of Conduct
          </a>
        </p>

        <div className="mt-8 space-y-8 text-ink-soft leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-ink">Purpose</h2>
            <p className="mt-2">
              A primary goal of the North London Cube Community is to be inclusive
              to the largest number of people, with the most varied and diverse
              backgrounds possible. As such, we are committed to providing a
              friendly, safe and welcoming environment for all, regardless of
              gender, sexual orientation, ability, ethnicity, socioeconomic status
              and religion (or lack thereof).
            </p>
            <p className="mt-2">
              This Code of Conduct outlines our expectations for all those who
              participate in our community, as well as the consequences for
              unacceptable behavior.
            </p>
            <p className="mt-2">
              We invite all those who participate in our events to help us create
              safe and positive experiences for everyone.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Community Citizenship</h2>
            <p className="mt-2">
              A supplemental goal of this Code of Conduct is to increase community
              citizenship by encouraging participants to recognize and strengthen
              the relationships between our actions and their effects on our
              community.
            </p>
            <p className="mt-2">
              Communities mirror the societies in which they exist and positive
              action is essential to counteract the many forms of inequality and
              abuses of power that exist in society.
            </p>
            <p className="mt-2">
              If you see someone who is making an extra effort to ensure our
              community is welcoming, friendly, and encourages all participants to
              contribute to the fullest extent, we want to know.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Expected Behavior</h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Participate in an authentic and active way. In doing so, you contribute to the health and longevity of this community.</li>
              <li>Exercise consideration and respect in your speech and actions.</li>
              <li>Attempt collaboration before conflict.</li>
              <li>Refrain from demeaning, discriminatory, or harassing behavior and speech.</li>
              <li>Be mindful of your surroundings and of your fellow participants. Alert community coordinators if you notice a dangerous situation, someone in distress, or violations of this Code of Conduct, even if they seem inconsequential.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Unacceptable Behavior</h2>
            <p className="mt-2">
              Unacceptable behaviors include: intimidating, harassing, abusive,
              discriminatory, derogatory or demeaning speech or actions by any
              participant in our community online, at all related events and in
              one-on-one communications carried out in the context of community
              business. Community event venues may be shared with members of the
              public; please be respectful to all patrons of these locations.
            </p>
            <p className="mt-2">
              Harassment includes: harmful or prejudicial verbal or written
              comments related to gender, sexual orientation, race, religion,
              disability; inappropriate use of nudity and/or sexual images;
              inappropriate depictions of violence; deliberate intimidation,
              stalking or following; harassing photography or recording; sustained
              disruption of events; inappropriate physical contact, and unwelcome
              sexual attention.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Consequences of Unacceptable Behavior</h2>
            <p className="mt-2">
              Unacceptable behavior from any community member, including those with
              decision-making authority, will not be tolerated. Anyone asked to
              stop unacceptable behavior is expected to comply immediately.
            </p>
            <p className="mt-2">
              If a community member engages in unacceptable behavior, the community
              coordinators may take any action they deem appropriate, up to and
              including a temporary ban or permanent expulsion from the community
              without warning.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">If You Witness or Are Subject to Unacceptable Behavior</h2>
            <p className="mt-2">
              If you are subject to or witness unacceptable behavior, or have any
              other concerns, please notify a community coordinator as soon as
              possible.
            </p>
            <p className="mt-2">
              Community coordinators are available to help community members engage
              with local law enforcement or to otherwise help those experiencing
              unacceptable behavior feel safe. In the context of in-person events,
              coordinators will also provide escorts as desired by the person
              experiencing distress.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Addressing Grievances</h2>
            <p className="mt-2">
              If you feel you have been falsely or unfairly accused of violating
              this Code of Conduct, you should notify a coordinator with a concise
              description of your grievance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Scope</h2>
            <p className="mt-2">
              We expect all community participants to abide by this Code of Conduct
              in all community venues — online and in-person — as well as in all
              one-on-one communications pertaining to community business.
            </p>
          </section>

          <section className="border-t border-rule pt-6">
            <h2 className="text-xl font-semibold text-ink">License and Attribution</h2>
            <p className="mt-2">
              This Code of Conduct is adapted from the{" "}
              <a href="https://berlincodeofconduct.org/" className="text-dci-teal underline" rel="noopener noreferrer">
                Berlin Code of Conduct
              </a>
              , which is distributed under a{" "}
              <a href="https://creativecommons.org/licenses/by-sa/4.0/" className="text-dci-teal underline" rel="noopener noreferrer">
                Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
              </a>{" "}
              license. The Berlin Code of Conduct is based on the{" "}
              <a href="https://pdxruby.org/CONDUCT" className="text-dci-teal underline" rel="noopener noreferrer">
                pdx.rb Code of Conduct
              </a>
              .
            </p>
            <p className="mt-2">
              This adapted version is likewise shared under{" "}
              <a href="https://creativecommons.org/licenses/by-sa/4.0/" className="text-dci-teal underline" rel="noopener noreferrer">
                CC BY-SA 4.0
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-rule pt-6 text-center">
          <Link to="/" className="text-dci-teal underline">Back to home</Link>
        </div>
      </div>
    </div>
  );
}
