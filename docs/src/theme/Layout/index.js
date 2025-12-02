import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme-original/Layout';

export default function LayoutWrapper(props) {
  return (
    <>
      <Layout {...props} />
      <Head>
        <title>Lodestar Documentation</title>
      </Head>
    </>
  );
}
